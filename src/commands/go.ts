import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import pc from 'picocolors';
import { getRepoRoot, getCurrentBranch, git } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import type { PawConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import type { SyncState } from '../lib/sync.js';
import {
  readSyncState,
  writeSyncState,
  completeTask,
  reopenTask,
  writeSyncFile,
  listSyncDir,
  resolveSyncDir,
  isTerminalStatus,
} from '../lib/sync.js';
import type { PawPaneConfig, AgentLivenessResult, TmuxServiceApi } from '../lib/tmux.js';
import {
  createTmuxService,
  checkAgentLiveness,
  ensureTmuxInstalled,
  isInsideTmux,
  tmuxSessionName,
  sendNudgeKeys,
} from '../lib/tmux.js';
import { readPaneConfig, resolvePaneTarget } from '../lib/pane-state.js';
import { DEFAULT_POLL_INTERVAL, REVIEW_MAX_RETRIES } from '../lib/constants.js';
import { isVerbose } from '../lib/context.js';
import { handleError, colors, pending, skip } from '../lib/output.js';
import { runWatchLoop } from './watch.js';
import { runUp } from './up.js';
import { runLaunch, printLaunchPreview } from './launch.js';
import { reviewTask } from '../lib/reviewer.js';

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

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

// --- State detection ---

export type SessionState =
  | 'no-session'
  | 'agents-running'
  | 'has-dead-agents'
  | 'all-done'
  | 'clean';

/** Pure decision logic — takes pre-fetched data, returns state. Testable without mocking. */
export function resolveSessionState(
  syncState: SyncState | null,
  paneConfig: PawPaneConfig | null,
  liveness: AgentLivenessResult[] | null,
): SessionState {
  if (!syncState) return 'no-session';

  const tasks = Object.values(syncState.tasks);
  if (tasks.length === 0) return 'clean';
  if (tasks.every((t) => isTerminalStatus(t.status))) return 'all-done';

  if (!paneConfig) return 'no-session';
  if (!liveness) return 'no-session';

  const notDone = liveness.filter((l) => {
    const status = syncState.tasks[l.taskName]?.status;
    return !status || !isTerminalStatus(status);
  });
  if (notDone.length === 0) return 'all-done';
  if (notDone.every((l) => l.alive)) return 'agents-running';
  if (notDone.some((l) => !l.alive)) return 'has-dead-agents';

  return 'agents-running';
}

/** Gather sync state, pane config, and tmux liveness, then resolve session state. */
export function detectSessionState(repoRoot: string): SessionState {
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

// --- Go command ---

export interface GoOpts {
  config?: string;
  pollInterval: string;
  detached?: boolean;
  task?: string;
  noMerge?: boolean;
  noReview?: boolean;
  noTeardown?: boolean;
  dryRun?: boolean;
}

export async function runGo(opts: GoOpts): Promise<void> {
  const repoRoot = getRepoRoot();
  const configPath = opts.config ?? resolveConfigPath(repoRoot);
  const pollInterval = parseInt(opts.pollInterval, 10);

  if (isNaN(pollInterval) || pollInterval < 1) {
    console.error(colors.error('Poll interval must be a positive integer (seconds).'));
    process.exit(1);
  }

  const config = loadConfig(configPath);

  // --- Dry run: preview what would happen ---
  if (opts.dryRun) {
    printDryRun(repoRoot, config, opts);
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

  const configArgs = opts.config ? ['-c', opts.config] : [];

  // --- Phase: up + launch (only for fresh sessions) ---
  if (state === 'no-session') {
    console.log(pc.bold('Step 1: paw up\n'));
    let phaseStart = Date.now();
    await runUp(repoRoot, configPath, config);
    if (verbose) console.log(colors.info(`⏰ up: ${formatElapsed(Date.now() - phaseStart)}`));

    console.log(pc.bold('\nStep 2: paw launch\n'));
    phaseStart = Date.now();
    await runLaunch(repoRoot, config, { detached: opts.detached, task: opts.task });
    if (verbose) console.log(colors.info(`⏰ launch: ${formatElapsed(Date.now() - phaseStart)}`));
  }

  // --- Phase: watch (for no-session, agents-running, has-dead-agents) ---
  if (state === 'no-session' || state === 'agents-running' || state === 'has-dead-agents') {
    console.log();
    await runWatchLoop({
      repoRoot,
      configPath,
      interval: pollInterval,
      noExit: false,
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

  // Phase: review
  if (!opts.noReview) {
    const worktrees = planWorktrees(config, repoRoot);
    const paneConfig = readPaneConfig(repoRoot);
    let tmux: TmuxServiceApi | null = null;
    try {
      tmux = createTmuxService();
    } catch {
      // tmux not available — skip review
      console.log(pc.dim('tmux not available — skipping review phase.'));
    }

    if (tmux) {
      for (let cycle = 0; cycle < REVIEW_MAX_RETRIES; cycle++) {
        let syncState = readSyncState(repoRoot);
        if (!syncState) break;

        const reviewTasks = Object.entries(syncState.tasks).filter(
          ([, t]) => t.status === 'in_review',
        );
        if (reviewTasks.length === 0) break;

        console.log(pc.bold(`\npaw review (cycle ${cycle + 1})\n`));
        let allPassed = true;

        for (const [taskName] of reviewTasks) {
          const wt = worktrees.find((w) => w.taskName === taskName);
          if (!wt) continue;

          // Resolve prior findings from sync branch
          const safeBranch = wt.branch.replace(/[^a-zA-Z0-9-]/g, '-');
          const priorFiles = listSyncDir('review', repoRoot).filter((f) =>
            f.startsWith(`review/${safeBranch}-cycle-`),
          );
          let priorFindingsPaths: string[] | undefined;
          if (priorFiles.length > 0) {
            const syncDir = resolveSyncDir(repoRoot);
            priorFindingsPaths = priorFiles.map((f) => resolve(syncDir, f));
          }

          console.log(pc.dim(`  Reviewing ${taskName}...`));
          const result = await reviewTask(
            tmux,
            wt.branch,
            config.target,
            repoRoot,
            {
              onWarning: (elapsed) =>
                console.log(pc.yellow(`  ⚠ ${taskName} reviewer still working (${elapsed})`)),
              onNudge: (elapsed) =>
                console.log(pc.yellow(`  📩 ${taskName} nudging reviewer to wrap up (${elapsed})`)),
              onCapture: (_elapsed, path) =>
                console.log(pc.dim(`  📋 ${taskName} reviewer capture saved: ${path}`)),
              onTimeout: (elapsed) =>
                console.log(pc.red(`  ⏱ ${taskName} reviewer timed out (${elapsed}) — skipping`)),
            },
            priorFindingsPaths,
          );

          // Persist findings to sync branch
          const findingsPath = `review/${safeBranch}-cycle-${cycle + 1}.md`;
          const findingsContent = [
            `# Review: ${taskName} — cycle ${cycle + 1}`,
            ``,
            `**Verdict:** ${result.verdict.toUpperCase()}`,
            `**Branch:** ${wt.branch}`,
            `**Date:** ${new Date().toISOString()}`,
            ``,
            `## Findings`,
            ``,
            result.findings,
            ``,
          ].join('\n');
          try {
            writeSyncFile(findingsPath, findingsContent, repoRoot);
          } catch (err: unknown) {
            console.log(pc.dim(`  warning: failed to persist findings: ${String(err)}`));
          }

          if (result.verdict === 'pass' || result.verdict === 'skip') {
            console.log(colors.success(`  ${taskName} -- PASS`));
            syncState = completeTask(syncState, taskName);
            writeSyncState(syncState, repoRoot);
          } else {
            console.log(colors.warn(`  ${taskName} -- FAIL`));
            console.log(
              pc.dim(
                result.findings
                  .split('\n')
                  .map((l) => `    ${l}`)
                  .join('\n'),
              ),
            );

            syncState = reopenTask(syncState, taskName);
            writeSyncState(syncState, repoRoot);
            allPassed = false;

            // Send findings back to builder agent via tmux
            if (paneConfig) {
              const target = resolvePaneTarget(paneConfig, taskName);
              if (target) {
                const msg =
                  `Review FAIL for "${taskName}". Fix these findings, then run paw review again:\n` +
                  result.findings;
                sendNudgeKeys(tmux, target, msg).catch((err) => {
                  if (isVerbose()) console.log(pc.dim(`  nudge delivery failed: ${err}`));
                });
              }
            }
          }
        }

        if (allPassed) break;

        // Re-enter watch loop for agents to fix findings
        console.log(pc.dim('\nWaiting for agents to address review findings...'));
        await runWatchLoop({
          repoRoot,
          configPath,
          interval: pollInterval,
          noExit: false,
          header: pc.dim('Watching for agents to re-submit after review...'),
          onAbort: () => {
            console.log(pc.dim('\nAborted.'));
            process.exit(130);
          },
        });
      }

      // Mark any remaining in_review tasks as done (max retries exceeded)
      const finalState = readSyncState(repoRoot);
      if (finalState) {
        let updated = finalState;
        for (const [taskName, task] of Object.entries(finalState.tasks)) {
          if (task.status === 'in_review') {
            console.log(colors.warn(`  ${taskName} -- max review cycles reached, proceeding`));
            updated = completeTask(updated, taskName);
          }
        }
        if (updated !== finalState) writeSyncState(updated, repoRoot);
      }
    }
  } else {
    // --no-review: mark all in_review tasks as done immediately
    const syncState = readSyncState(repoRoot);
    if (syncState) {
      let updated = syncState;
      for (const [taskName, task] of Object.entries(syncState.tasks)) {
        if (task.status === 'in_review') {
          updated = completeTask(updated, taskName);
        }
      }
      if (updated !== syncState) writeSyncState(updated, repoRoot);
    }
  }

  // --- Phase: merge ---
  if (opts.noMerge) {
    console.log(pc.dim('\n--no-merge: stopping before merge. Run `paw merge` when ready.'));
    return;
  }

  console.log(pc.bold('\npaw merge\n'));
  let phaseStart = Date.now();

  // Clean all transient runtime state before checkout to avoid conflicts.
  // Everything under .paw/run/ is session-scoped and disposable.
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

  const mergeResult = runPawCommand(['merge', ...configArgs]);
  if (mergeResult.exitCode !== 0) {
    console.log(colors.warn('\nMerge failed. Resolve the issue, then run: paw merge --continue'));
    console.log(colors.warn('Worktrees left intact (skipping paw down).'));
    return;
  }
  if (verbose) console.log(colors.info(`⏰ merge: ${formatElapsed(Date.now() - phaseStart)}`));

  // --- Phase: down ---
  if (opts.noTeardown) {
    console.log(pc.dim('\n--no-teardown: worktrees left intact. Run `paw down` when ready.'));
    if (verbose) console.log(colors.info(`⏰ total: ${formatElapsed(Date.now() - totalStart)}`));
    console.log(colors.success(`\nDone. Work merged to ${config.target}.`));
    return;
  }

  console.log(pc.bold('\npaw down\n'));
  phaseStart = Date.now();
  const downResult = runPawCommand(['down', ...configArgs]);
  if (downResult.exitCode !== 0) {
    console.error(colors.error('\npaw down failed.'));
    process.exit(downResult.exitCode);
  }
  if (verbose) console.log(colors.info(`⏰ down: ${formatElapsed(Date.now() - phaseStart)}`));

  if (verbose) console.log(colors.info(`⏰ total: ${formatElapsed(Date.now() - totalStart)}`));
  console.log(colors.success(`\nDone. Work merged to ${config.target}.`));
}

function printDryRun(repoRoot: string, config: PawConfig, opts: GoOpts): void {
  const state = detectSessionState(repoRoot);
  const useDetached = opts.detached || !isInsideTmux();
  const sessionName = tmuxSessionName(basename(repoRoot));
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);
  const targets = opts.task ? worktrees.filter((wt) => wt.taskName === opts.task) : worktrees;

  console.log(pc.bold('paw go (dry run)'));
  console.log(`  target:  ${config.target}`);
  console.log(`  tasks:   ${targets.length}`);
  console.log(`  state:   ${state}`);
  console.log(`  mode:    ${useDetached ? 'detached' : 'attached'}`);
  console.log(`  session: ${sessionName}`);
  if (opts.noReview) console.log(`  flags:   --no-review`);
  if (opts.noMerge) console.log(`  flags:   --no-merge`);
  if (opts.noTeardown) console.log(`  flags:   --no-teardown`);
  console.log();

  if (state === 'clean') {
    console.log(pc.dim('Nothing to do.'));
    return;
  }

  if (state === 'no-session') {
    console.log(pc.bold('Would create worktrees:\n'));
    for (const wt of targets) {
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
    printLaunchPreview(targets, syncState, useDetached, config.agent);
  }

  if (state === 'agents-running') {
    console.log('Would attach to watch loop (agents are running).');
  }

  if (state === 'has-dead-agents') {
    console.log('Would relaunch dead agents and watch for completion.');
    for (const wt of targets) {
      const taskState = syncState?.tasks[wt.taskName];
      if (taskState?.status === 'done' || taskState?.status === 'in_review') {
        skip(wt.taskName, taskState.status === 'in_review' ? 'in review' : 'done');
      } else {
        pending(wt.taskName, 'would check liveness / relaunch if dead');
      }
    }
  }

  if (state === 'all-done') {
    console.log('All agents done. Would proceed to review and merge.');
  }

  console.log();
  if (!opts.noReview) console.log(pc.dim('→ Would review submitted PRs'));
  if (!opts.noMerge) console.log(pc.dim('→ Would merge completed branches'));
  if (!opts.noMerge && !opts.noTeardown) console.log(pc.dim('→ Would tear down worktrees'));
  console.log(pc.dim('\nDry run -- no changes made.'));
}

export function goCommand(): Command {
  return new Command('go')
    .description('Run the full workflow: up → launch → watch → review → merge → down')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option(
      '--poll-interval <seconds>',
      'Poll interval in seconds for watching agents',
      DEFAULT_POLL_INTERVAL,
    )
    .option('--detached', 'Force detached mode (background tmux sessions)')
    .option('-t, --task <name>', 'Spawn and watch a single task only')
    .option('--no-review', 'Skip PR review phase')
    .option('--no-merge', 'Stop after all agents done (inspect before merging)')
    .option('--no-teardown', 'Merge but keep worktrees (inspect after merging)')
    .option('--dry-run', 'Preview what would happen without executing')
    .action(async (opts: GoOpts) => {
      try {
        await runGo(opts);
      } catch (err) {
        handleError(err);
      }
    });
}
