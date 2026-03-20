import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import pc from 'picocolors';
import { intro, log, outro } from '@clack/prompts';
import { getCurrentBranch, git } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import type { FleetConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import type { SyncState } from '../lib/sync.js';
import { readSyncState } from '../lib/sync.js';
import type { FleetPaneConfig, AgentLivenessResult } from '../lib/tmux.js';
import {
  createTmuxService,
  checkAgentLiveness,
  ensureTmuxInstalled,
  ensureNativeFilesystem,
  tmuxSessionName,
} from '../lib/tmux.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { isVerbose } from '../lib/context.js';
import { handleError, colors, pending, skip } from '../lib/output.js';
import { formatElapsed } from '../lib/util.js';
import { runWatchLoop } from './watch.js';
import { runUp } from './up.js';
import { runLaunch, printLaunchPreview } from './launch.js';

/** Shell out to a fleet subcommand. Returns the exit code. */
export function runFleetCommand(args: string[]): { exitCode: number } {
  const scriptPath = process.argv[1];
  if (!scriptPath) throw new Error('Cannot determine CLI script path');
  try {
    execFileSync(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
    });
    return { exitCode: 0 };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'status' in err ? (err.status as number | null) : null;
    return { exitCode: code ?? 1 };
  }
}

type SessionState = 'no-session' | 'agents-running' | 'has-dead-agents' | 'all-done' | 'clean';

/** Pure decision logic — takes pre-fetched data, returns state. Testable without mocking. */
export function resolveSessionState(
  syncState: SyncState | null,
  paneConfig: FleetPaneConfig | null,
  liveness: AgentLivenessResult[] | null,
): SessionState {
  if (!syncState) return 'no-session';

  const tasks = Object.values(syncState.tasks);
  if (tasks.length === 0) return 'clean';
  if (tasks.every((t) => t.status === 'done')) return 'all-done';

  if (!paneConfig) return 'no-session';
  if (!liveness) return 'no-session';

  const notDone = liveness.filter((l) => {
    const status = syncState.tasks[l.taskName]?.status;
    return status !== 'done';
  });
  if (notDone.length === 0) return 'all-done';
  if (notDone.every((l) => l.alive)) return 'agents-running';
  if (notDone.some((l) => !l.alive)) return 'has-dead-agents';

  return 'agents-running';
}

/** Gather sync state, pane config, and tmux liveness, then resolve session state. */
function detectSessionState(repoRoot: string): SessionState {
  const syncState = readSyncState(repoRoot);
  const paneConfig = readPaneConfig(repoRoot);

  let liveness: AgentLivenessResult[] | null = null;
  if (paneConfig) {
    try {
      const tmux = createTmuxService();
      liveness = checkAgentLiveness(tmux, paneConfig);
    } catch {
      // tmux not available
    }
  }

  return resolveSessionState(syncState, paneConfig, liveness);
}

/** Options for the `fleet go` lifecycle command. */
interface GoOpts {
  dryRun?: boolean;
}

/** Execute the full fleet lifecycle: up, launch, watch, merge, down. */
export async function runGo(opts: GoOpts): Promise<void> {
  const { repoRoot, configPath, config } = loadRepoConfig();
  const pollInterval = DEFAULT_POLL_INTERVAL;

  if (opts.dryRun) {
    printDryRun(repoRoot, config);
    return;
  }

  ensureTmuxInstalled();
  ensureNativeFilesystem(repoRoot);
  const verbose = isVerbose();
  const totalStart = Date.now();
  const taskCount = Object.keys(config.tasks).length;
  const rail = `${pc.dim('│')}  `;

  const state = detectSessionState(repoRoot);

  intro('fleet go');
  console.log(`${rail}target: ${config.target} · ${taskCount} tasks`);

  if (state === 'clean') {
    outro('Nothing to do.');
    return;
  }

  if (state === 'no-session') {
    let phaseStart = Date.now();
    const worktrees = await runUp(repoRoot, configPath, config, { quiet: true });
    log.step('fleet up');
    console.log(`${rail}${worktrees.map((w) => w.taskName).join(' · ')}`);
    if (verbose)
      console.log(`${rail}${colors.info(`⏰ up: ${formatElapsed(Date.now() - phaseStart)}`)}`);

    phaseStart = Date.now();
    const launched = await runLaunch(repoRoot, config, { quiet: true });
    log.step('fleet launch');
    console.log(`${rail}${launched} agent${launched === 1 ? '' : 's'} spawned`);
    if (verbose)
      console.log(`${rail}${colors.info(`⏰ launch: ${formatElapsed(Date.now() - phaseStart)}`)}`);
  }

  if (state === 'no-session' || state === 'agents-running' || state === 'has-dead-agents') {
    console.log(pc.dim('│'));
    console.log(`${pc.magenta('●')}  watching ${taskCount} tasks...`);
    await runWatchLoop({
      repoRoot,
      configPath,
      interval: pollInterval,
      header: '',
      linePrefix: rail,
      onAbort: () => {
        console.log(pc.dim('\nAborted.'));
        process.exit(130);
      },
    });
    if (verbose)
      console.log(`${rail}${colors.info(`⏰ watch: ${formatElapsed(Date.now() - totalStart)}`)}`);
    log.step('all tasks complete');
  }

  let phaseStart = Date.now();

  // Remove before checkout to avoid "untracked files would be overwritten"
  const runDir = resolve(repoRoot, '.fleet', 'run');
  try {
    rmSync(runDir, { recursive: true });
  } catch {
    /* already gone */
  }

  const currentBranch = getCurrentBranch(repoRoot);
  if (currentBranch !== config.target) {
    git(['checkout', config.target], { cwd: repoRoot });
  }

  const mergeResult = runFleetCommand(['merge']);
  if (mergeResult.exitCode !== 0) {
    log.warn('Merge failed. Resolve the issue, then run: fleet merge --continue');
    log.warn('Worktrees left intact (skipping fleet down).');
    return;
  }
  log.step('fleet merge');
  if (verbose)
    console.log(`${rail}${colors.info(`⏰ merge: ${formatElapsed(Date.now() - phaseStart)}`)}`);

  phaseStart = Date.now();
  const downResult = runFleetCommand(['down']);
  if (downResult.exitCode !== 0) {
    log.error('fleet down failed.');
    process.exit(downResult.exitCode);
  }
  log.step('fleet down');
  if (verbose)
    console.log(`${rail}${colors.info(`⏰ down: ${formatElapsed(Date.now() - phaseStart)}`)}`);

  if (verbose)
    console.log(`${rail}${colors.info(`⏰ total: ${formatElapsed(Date.now() - totalStart)}`)}`);
  outro(`Done — run \`fleet shortcut finish-branch\``);
}

function printDryRun(repoRoot: string, config: FleetConfig): void {
  const state = detectSessionState(repoRoot);
  const sessionName = tmuxSessionName(basename(repoRoot));
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);

  console.log(pc.bold('fleet go (dry run)'));
  console.log(`  target:  ${config.target}`);
  console.log(`  tasks:   ${worktrees.length}`);
  console.log(`  state:   ${state}`);
  console.log(`  mode:    detached`);
  console.log(`  session: ${sessionName}`);
  console.log();

  if (state === 'clean') {
    console.log(pc.dim('Nothing to do.'));
    return;
  }

  if (state === 'no-session') {
    console.log(pc.bold('Would create worktrees:\n'));
    for (const wt of worktrees) {
      pending(wt.taskName, `${wt.branch} → ${wt.worktreePath}`);
    }
    const claudeDir = resolve(repoRoot, '.claude');
    if (existsSync(claudeDir)) {
      console.log(pc.dim('\n  .claude/ will be copied into each worktree'));
    }
    if (config.include?.length) {
      console.log(pc.dim(`  include: ${config.include.join(', ')}`));
    }

    console.log(pc.bold('\nWould launch agents:\n'));
    printLaunchPreview(worktrees, syncState);
  }

  if (state === 'agents-running') {
    console.log('Would attach to watch loop (agents are running).');
  }

  if (state === 'has-dead-agents') {
    console.log('Would relaunch dead agents and watch for completion.');
    for (const wt of worktrees) {
      const taskState = syncState?.tasks[wt.taskName];
      if (taskState?.status === 'done') {
        skip(wt.taskName, 'done');
      } else {
        pending(wt.taskName, 'would check liveness / relaunch if dead');
      }
    }
  }

  if (state === 'all-done') {
    console.log('All agents done. Would proceed to merge.');
  }

  console.log();
  console.log(pc.dim('→ Would merge completed branches'));
  console.log(pc.dim('→ Would tear down worktrees'));
  console.log(pc.dim(`\nLifecycle: up → launch → watch → merge → down`));
  console.log(pc.dim('\nDry run -- no changes made.'));
}

/** Build the `fleet go` CLI command. */
export function goCommand(): Command {
  return new Command('go')
    .description('Run the full workflow: up → launch → watch → merge → down')
    .option('--dry-run', 'Preview what would happen without executing')
    .action(async (opts: GoOpts) => {
      try {
        await runGo(opts);
      } catch (err) {
        handleError(err);
      }
    });
}
