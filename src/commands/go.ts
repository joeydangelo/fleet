import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import pc from 'picocolors';
import { getCurrentBranch, git } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import type { PawConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import type { SyncState } from '../lib/sync.js';
import { readSyncState } from '../lib/sync.js';
import type { PawPaneConfig, AgentLivenessResult } from '../lib/tmux.js';
import {
  createTmuxService,
  checkAgentLiveness,
  ensureTmuxInstalled,
  isInsideTmux,
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

/** Shell out to a paw subcommand. Returns the exit code. */
export function runPawCommand(args: string[]): { exitCode: number } {
  try {
    execFileSync(process.execPath, [process.argv[1]!, ...args], {
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
  paneConfig: PawPaneConfig | null,
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

/** Options for the `paw go` lifecycle command. */
interface GoOpts {
  dryRun?: boolean;
}

/** Execute the full paw lifecycle: up, launch, watch, merge, down. */
export async function runGo(opts: GoOpts): Promise<void> {
  const { repoRoot, configPath, config } = loadRepoConfig();
  const pollInterval = DEFAULT_POLL_INTERVAL;

  if (opts.dryRun) {
    printDryRun(repoRoot, config);
    return;
  }

  ensureTmuxInstalled();
  const verbose = isVerbose();
  const totalStart = Date.now();

  const state = detectSessionState(repoRoot);
  console.log(pc.bold('paw go'));
  console.log(`  target: ${config.target}`);
  console.log(`  tasks:  ${Object.keys(config.tasks).length}`);
  console.log(`  state:  ${state}\n`);

  if (state === 'clean') {
    console.log(pc.dim('Nothing to do.'));
    return;
  }

  if (state === 'no-session') {
    console.log(pc.bold('Step 1: paw up\n'));
    let phaseStart = Date.now();
    await runUp(repoRoot, configPath, config);
    if (verbose) console.log(colors.info(`⏰ up: ${formatElapsed(Date.now() - phaseStart)}`));

    console.log(pc.bold('\nStep 2: paw launch\n'));
    phaseStart = Date.now();
    await runLaunch(repoRoot, config);
    if (verbose) console.log(colors.info(`⏰ launch: ${formatElapsed(Date.now() - phaseStart)}`));
  }

  if (state === 'no-session' || state === 'agents-running' || state === 'has-dead-agents') {
    console.log();
    await runWatchLoop({
      repoRoot,
      configPath,
      interval: pollInterval,
      header: pc.dim(
        `Watching ${Object.keys(config.tasks).length} task(s), polling every ${pollInterval}s...`,
      ),
      onAbort: () => {
        console.log(pc.dim('\nAborted.'));
        process.exit(130);
      },
    });
    if (verbose) console.log(colors.info(`⏰ watch: ${formatElapsed(Date.now() - totalStart)}`));
  }

  console.log(pc.bold('\npaw merge\n'));
  let phaseStart = Date.now();

  // Remove before checkout to avoid "untracked files would be overwritten"
  const runDir = resolve(repoRoot, '.paw', 'run');
  try {
    rmSync(runDir, { recursive: true });
  } catch {
    /* already gone */
  }

  const currentBranch = getCurrentBranch(repoRoot);
  if (currentBranch !== config.target) {
    console.log(pc.dim(`Switching to target branch: ${config.target}`));
    git(['checkout', config.target], { cwd: repoRoot });
  }

  const mergeResult = runPawCommand(['merge']);
  if (mergeResult.exitCode !== 0) {
    console.log(colors.warn('\nMerge failed. Resolve the issue, then run: paw merge --continue'));
    console.log(colors.warn('Worktrees left intact (skipping paw down).'));
    return;
  }
  if (verbose) console.log(colors.info(`⏰ merge: ${formatElapsed(Date.now() - phaseStart)}`));

  console.log(pc.bold('\npaw down\n'));
  phaseStart = Date.now();
  const downResult = runPawCommand(['down']);
  if (downResult.exitCode !== 0) {
    console.error(colors.error('\npaw down failed.'));
    process.exit(downResult.exitCode);
  }
  if (verbose) console.log(colors.info(`⏰ down: ${formatElapsed(Date.now() - phaseStart)}`));

  if (verbose) console.log(colors.info(`⏰ total: ${formatElapsed(Date.now() - totalStart)}`));
  console.log(colors.success(`\nDone. Work merged to ${config.target}.`));
  console.log(pc.dim(`Next: run \`paw shortcut finish-branch\``));
}

function printDryRun(repoRoot: string, config: PawConfig): void {
  const state = detectSessionState(repoRoot);
  const useDetached = !isInsideTmux();
  const sessionName = tmuxSessionName(basename(repoRoot));
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);

  console.log(pc.bold('paw go (dry run)'));
  console.log(`  target:  ${config.target}`);
  console.log(`  tasks:   ${worktrees.length}`);
  console.log(`  state:   ${state}`);
  console.log(`  mode:    ${useDetached ? 'detached' : 'attached'}`);
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
    printLaunchPreview(worktrees, syncState, useDetached, config.agent);
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

/** Build the `paw go` CLI command. */
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
