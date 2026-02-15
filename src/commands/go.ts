import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import pc from 'picocolors';
import {
  getRepoRoot,
  getCommitCount,
  getChangedFileCount,
  getCurrentBranch,
  git,
} from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import type { TaskState } from '../lib/sync.js';
import { readJournal } from '../lib/journal.js';
import { handleError } from '../lib/output.js';
import { diffJournal, diffStatuses, diffCommitCounts, isAllDone, assignColor } from './watch.js';

function timestamp(): string {
  const now = new Date();
  return pc.dim(
    `[${now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]`,
  );
}

function colorTask(name: string, taskIndex: Map<string, number>): string {
  const idx = taskIndex.get(name) ?? 0;
  return assignColor(idx)(name);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAgents(opts: {
  repoRoot: string;
  configPath: string;
  pollInterval: number;
}): Promise<void> {
  const { repoRoot, configPath, pollInterval } = opts;
  const config = loadConfig(configPath);
  const worktrees = planWorktrees(config, repoRoot);
  const taskNames = worktrees.map((w) => w.taskName);

  const taskIndex = new Map<string, number>();
  taskNames.forEach((name, i) => taskIndex.set(name, i));

  let lastSeenTs: string | undefined;
  let prevStatuses: Record<string, TaskState['status']> = {};
  let prevCommitCounts: Record<string, number> = {};

  let aborted = false;
  const onSignal = () => {
    aborted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  console.log(pc.dim(`Watching ${taskNames.length} task(s), polling every ${pollInterval}s...`));
  console.log(pc.dim(`Tasks: ${taskNames.map((n, i) => assignColor(i)(n)).join(', ')}`));
  console.log();

  try {
    while (!aborted) {
      const syncState = readSyncState(repoRoot);
      if (!syncState) {
        await sleep(pollInterval * 1000);
        continue;
      }

      // Journal diff
      const journal = readJournal(repoRoot);
      const journalDiff = diffJournal(journal, lastSeenTs);
      lastSeenTs = journalDiff.lastSeenTs;

      for (const entry of journalDiff.newEntries) {
        const from = colorTask(entry.from, taskIndex);
        if (entry.type === 'broadcast') {
          console.log(`${timestamp()}   ${from} broadcast: ${entry.msg}`);
        } else if (entry.to) {
          const to = colorTask(entry.to, taskIndex);
          console.log(`${timestamp()}   ${from} → ${to}: ${entry.msg}`);
        } else {
          console.log(`${timestamp()}   ${from}: ${entry.msg}`);
        }
      }

      // Status diff
      const statusDiff = diffStatuses(prevStatuses, syncState.tasks);
      prevStatuses = statusDiff.currentStatuses;

      for (const t of statusDiff.transitions) {
        const name = colorTask(t.task, taskIndex);
        if (t.to === 'in_progress') {
          console.log(`${timestamp()} ${pc.green('+')} ${name} claimed task`);
        } else if (t.to === 'completed') {
          console.log(`${timestamp()} ${pc.green('✓')} ${name} done`);
        } else if (t.from !== undefined) {
          console.log(`${timestamp()}   ${name} ${t.from} → ${t.to}`);
        }
      }

      // Commit count diff
      const currentCommitCounts: Record<string, number> = {};
      for (const wt of worktrees) {
        try {
          currentCommitCounts[wt.taskName] = getCommitCount(wt.branch, config.target, repoRoot);
        } catch {
          currentCommitCounts[wt.taskName] = prevCommitCounts[wt.taskName] ?? 0;
        }
      }

      const commitDiff = diffCommitCounts(prevCommitCounts, currentCommitCounts);
      prevCommitCounts = commitDiff.currentCounts;

      for (const d of commitDiff.deltas) {
        const name = colorTask(d.task, taskIndex);
        let fileCount: number | undefined;
        try {
          const wt = worktrees.find((w) => w.taskName === d.task);
          if (wt) {
            fileCount = getChangedFileCount(wt.branch, config.target, repoRoot);
          }
        } catch {
          // skip
        }
        const filesStr = fileCount !== undefined ? `, ${fileCount} file(s)` : '';
        console.log(
          `${timestamp()}   ${name} +${d.to - d.from} commit(s) (${d.to} total${filesStr})`,
        );
      }

      // Check completion
      if (isAllDone(syncState.tasks)) {
        console.log(`${timestamp()} All agents done.\n`);
        break;
      }

      await sleep(pollInterval * 1000);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  if (aborted) {
    console.log(pc.dim('\nAborted.'));
    process.exit(130);
  }
}

export interface GoOpts {
  config?: string;
  pollInterval: string;
}

export async function runGo(opts: GoOpts): Promise<void> {
  const repoRoot = getRepoRoot();
  const configPath = opts.config ?? resolveConfigPath(repoRoot);
  const pollInterval = parseInt(opts.pollInterval, 10);

  if (isNaN(pollInterval) || pollInterval < 1) {
    console.error(pc.red('Poll interval must be a positive integer (seconds).'));
    process.exit(1);
  }

  const config = loadConfig(configPath);
  console.log(pc.bold('paw go'));
  console.log(`  target: ${config.target}`);
  console.log(`  tasks:  ${Object.keys(config.tasks).length}\n`);

  // Step 1: paw up
  console.log(pc.bold('Step 1/4: paw up\n'));
  const configArgs = opts.config ? ['-c', opts.config] : [];
  const upResult = runPawCommand(['up', ...configArgs]);
  if (upResult.exitCode !== 0) {
    console.error(pc.red('\npaw up failed. Aborting.'));
    process.exit(upResult.exitCode);
  }

  // Step 2: paw launch (+ inline watch)
  console.log(pc.bold('\nStep 2/4: paw launch\n'));
  const launchResult = runPawCommand(['launch', ...configArgs]);
  if (launchResult.exitCode !== 0) {
    console.error(pc.red('\npaw launch failed. Aborting.'));
    process.exit(launchResult.exitCode);
  }

  // Wait for agents with inline watch output
  console.log();
  await waitForAgents({ repoRoot, configPath, pollInterval });

  // Step 3: paw merge
  console.log(pc.bold('Step 3/4: paw merge\n'));

  // Checkout the target branch -- paw merge requires it
  const currentBranch = getCurrentBranch(repoRoot);
  if (currentBranch !== config.target) {
    console.log(pc.dim(`Switching to target branch: ${config.target}`));
    git(['checkout', config.target], { cwd: repoRoot });
  }

  const mergeResult = runPawCommand(['merge', ...configArgs]);
  if (mergeResult.exitCode !== 0) {
    console.log(
      pc.yellow('\nMerge conflict detected. Resolve manually, then run: paw merge --continue'),
    );
    console.log(pc.yellow('Worktrees left intact (skipping paw down).'));
    return;
  }

  // Step 4: paw down
  console.log(pc.bold('\nStep 4/4: paw down\n'));
  const downResult = runPawCommand(['down', ...configArgs]);
  if (downResult.exitCode !== 0) {
    console.error(pc.red('\npaw down failed.'));
    process.exit(downResult.exitCode);
  }

  console.log(pc.green(`\nDone. Work merged to ${config.target}.`));
}

export function goCommand(): Command {
  return new Command('go')
    .description('Run the full workflow: up → launch → watch → merge → down')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--poll-interval <seconds>', 'Poll interval in seconds for watching agents', '5')
    .action(async (opts: GoOpts) => {
      try {
        await runGo(opts);
      } catch (err) {
        handleError(err);
      }
    });
}
