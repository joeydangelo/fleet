import { Command } from 'commander';
import pc from 'picocolors';
import type { Formatter } from 'picocolors/types.js';
import { getRepoRoot, getCommitCount, getChangedFileCount } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import type { TaskState } from '../lib/sync.js';
import { readJournal } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { readPaneConfig, saveDetachedAgents } from '../lib/pane-state.js';
import {
  checkAgentLiveness,
  createTmuxService,
  killDetachedSession,
  createDetachedSession,
} from '../lib/tmux.js';
import {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_STALL_THRESHOLD,
  MAX_RELAUNCH_ATTEMPTS,
} from '../lib/constants.js';
import { handleError, colors } from '../lib/output.js';

// --- Color palette for task names ---

const COLOR_PALETTE: Formatter[] = [pc.blue, pc.green, pc.yellow, pc.magenta, pc.cyan, pc.red];

function assignColor(index: number): Formatter {
  return COLOR_PALETTE[index % COLOR_PALETTE.length]!;
}

// --- Diff logic (pure, testable functions) ---

interface JournalDiff {
  newEntries: JournalEntry[];
  lastSeenTs: string | undefined;
}

export function diffJournal(entries: JournalEntry[], lastSeenTs: string | undefined): JournalDiff {
  if (entries.length === 0) {
    return { newEntries: [], lastSeenTs };
  }

  const newEntries = lastSeenTs ? entries.filter((e) => e.ts > lastSeenTs) : entries;

  const maxTs = entries[entries.length - 1]!.ts;
  return {
    newEntries,
    lastSeenTs: lastSeenTs && newEntries.length === 0 ? lastSeenTs : maxTs,
  };
}

interface StatusTransition {
  task: string;
  from: TaskState['status'] | undefined;
  to: TaskState['status'];
}

interface StatusDiff {
  transitions: StatusTransition[];
  currentStatuses: Record<string, TaskState['status']>;
}

export function diffStatuses(
  prev: Record<string, TaskState['status']>,
  curr: Record<string, TaskState>,
): StatusDiff {
  const transitions: StatusTransition[] = [];
  const currentStatuses: Record<string, TaskState['status']> = {};

  for (const [task, state] of Object.entries(curr)) {
    currentStatuses[task] = state.status;
    const prevStatus = prev[task];
    if (prevStatus !== state.status) {
      transitions.push({ task, from: prevStatus, to: state.status });
    }
  }

  return { transitions, currentStatuses };
}

interface CommitDelta {
  task: string;
  from: number;
  to: number;
}

interface CommitCountDiff {
  deltas: CommitDelta[];
  currentCounts: Record<string, number>;
}

export function diffCommitCounts(
  prev: Record<string, number>,
  curr: Record<string, number>,
): CommitCountDiff {
  const deltas: CommitDelta[] = [];
  const currentCounts: Record<string, number> = { ...curr };

  for (const [task, count] of Object.entries(curr)) {
    const prevCount = prev[task] ?? 0;
    if (count !== prevCount) {
      deltas.push({ task, from: prevCount, to: count });
    }
  }

  return { deltas, currentCounts };
}

// --- Crash recovery (pure logic) ---

export interface DeadAgentAction {
  taskName: string;
  action: 'relaunch' | 'max-attempts';
}

export function findDeadAgents(
  taskNames: string[],
  livenessMap: Map<string, boolean>,
  syncTasks: Record<string, TaskState>,
  relaunchCounts: Record<string, number>,
  maxAttempts: number,
): DeadAgentAction[] {
  const actions: DeadAgentAction[] = [];
  for (const name of taskNames) {
    if (syncTasks[name]?.status === 'done') continue;
    const alive = livenessMap.get(name);
    if (alive !== false) continue;

    const count = relaunchCounts[name] ?? 0;
    if (count >= maxAttempts) {
      actions.push({ taskName: name, action: 'max-attempts' });
    } else {
      actions.push({ taskName: name, action: 'relaunch' });
    }
  }
  return actions;
}

function isAllDone(tasks: Record<string, TaskState>): boolean {
  const entries = Object.values(tasks);
  if (entries.length === 0) return false;
  return entries.every((t) => t.status === 'done');
}

// --- Output formatting ---

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

function printJournalEntry(entry: JournalEntry, taskIndex: Map<string, number>): void {
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

function printStatusTransition(t: StatusTransition, taskIndex: Map<string, number>): void {
  const name = colorTask(t.task, taskIndex);

  if (t.to === 'in_progress') {
    console.log(`${timestamp()} ${colors.success('+')} ${name} claimed task`);
  } else if (t.to === 'done') {
    console.log(`${timestamp()} ${colors.success('✓')} ${name} done`);
  } else if (t.from === undefined) {
    // New task appearing -- skip silent "pending" entries on first poll
  } else {
    console.log(`${timestamp()}   ${name} ${t.from} → ${t.to}`);
  }
}

function printCommitDelta(
  d: CommitDelta,
  taskIndex: Map<string, number>,
  fileCount?: number,
): void {
  const name = colorTask(d.task, taskIndex);
  const delta = d.to - d.from;
  const filesStr = fileCount !== undefined ? `, ${fileCount} file(s)` : '';
  console.log(`${timestamp()}   ${name} +${delta} commit(s) (${d.to} total${filesStr})`);
}

function printSummary(): void {
  console.log(`${timestamp()} All agents done.`);
}

function printStallWarning(
  taskName: string,
  taskIndex: Map<string, number>,
  stalledMinutes: number,
  tmuxAlive: boolean,
): void {
  const name = colorTask(taskName, taskIndex);
  if (tmuxAlive) {
    console.log(
      `${timestamp()} ${colors.warn('⚠')} ${name} — no commits for ${stalledMinutes}m, tmux alive`,
    );
  } else {
    console.log(`${timestamp()} ${colors.error('✗')} ${name} — tmux session dead`);
  }
}

function printRelaunch(
  taskName: string,
  taskIndex: Map<string, number>,
  attempt: number,
  maxAttempts: number,
): void {
  const name = colorTask(taskName, taskIndex);
  console.log(
    `${timestamp()} ${colors.warn('↻')} ${name} — relaunched (attempt ${attempt}/${maxAttempts})`,
  );
}

function printMaxAttempts(taskName: string, taskIndex: Map<string, number>): void {
  const name = colorTask(taskName, taskIndex);
  console.log(
    `${timestamp()} ${colors.error('✗')} ${name} — max relaunch attempts (${MAX_RELAUNCH_ATTEMPTS}) reached`,
  );
}

// --- Poll loop ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls sync state, journal, and commit counts on an interval, printing diffs. Handles SIGINT/SIGTERM for clean shutdown. */
export async function runWatchLoop(opts: {
  repoRoot: string;
  configPath: string;
  interval: number;
  noExit: boolean;
  stallThreshold: number;
  header?: string;
  onAbort?: () => void;
  crashRecovery?: { agentCommand: string };
}): Promise<void> {
  const { repoRoot, configPath, interval, noExit, stallThreshold, onAbort } = opts;
  const config = loadConfig(configPath);
  const worktrees = planWorktrees(config, repoRoot);
  const taskNames = worktrees.map((w) => w.taskName);

  // Build stable task→index map for color assignment
  const taskIndex = new Map<string, number>();
  taskNames.forEach((name, i) => taskIndex.set(name, i));

  // Diff tracking state
  let lastSeenTs: string | undefined;
  let prevStatuses: Record<string, TaskState['status']> = {};
  let prevCommitCounts: Record<string, number> = {};

  // Stall detection: track when each task last had a commit change
  const lastCommitTime: Record<string, number> = {};
  const now = Date.now();
  for (const name of taskNames) {
    lastCommitTime[name] = now;
  }
  // Track which tasks have already been warned about (avoid spamming)
  const stallWarned = new Set<string>();
  const deadWarned = new Set<string>();
  const relaunchCounts: Record<string, number> = {};

  let aborted = false;
  const onSignal = () => {
    aborted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  if (opts.header !== undefined) {
    console.log(opts.header);
  } else {
    console.log(
      pc.bold('paw watch') + pc.dim(` (polling every ${interval}s, ${taskNames.length} task(s))`),
    );
  }
  console.log(pc.dim(`Tasks: ${taskNames.map((n, i) => assignColor(i)(n)).join(', ')}`));
  console.log();

  try {
    while (!aborted) {
      // Read current state
      const syncState = readSyncState(repoRoot);
      if (!syncState) {
        console.log(pc.dim(`${timestamp()} No sync state yet, waiting...`));
        await sleep(interval * 1000);
        continue;
      }

      // 1. Diff journal
      const journal = readJournal(repoRoot);
      const journalDiff = diffJournal(journal, lastSeenTs);
      lastSeenTs = journalDiff.lastSeenTs;

      for (const entry of journalDiff.newEntries) {
        printJournalEntry(entry, taskIndex);
      }

      // 2. Diff statuses
      const statusDiff = diffStatuses(prevStatuses, syncState.tasks);
      prevStatuses = statusDiff.currentStatuses;

      for (const t of statusDiff.transitions) {
        printStatusTransition(t, taskIndex);
      }

      // 3. Diff commit counts
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
        // Reset stall timer on new commits
        lastCommitTime[d.task] = Date.now();
        stallWarned.delete(d.task);

        let fileCount: number | undefined;
        try {
          const wt = worktrees.find((w) => w.taskName === d.task);
          if (wt) {
            fileCount = getChangedFileCount(wt.branch, config.target, repoRoot);
          }
        } catch {
          // Skip file count on error
        }
        printCommitDelta(d, taskIndex, fileCount);
      }

      // 4. Stall detection + liveness check + crash recovery
      if (stallThreshold > 0) {
        const livenessMap = new Map<string, boolean>();
        const paneConfig = readPaneConfig(repoRoot);
        let tmux: ReturnType<typeof createTmuxService> | undefined;
        if (paneConfig) {
          try {
            tmux = createTmuxService();
            const results = checkAgentLiveness(tmux, paneConfig);
            for (const r of results) {
              livenessMap.set(r.taskName, r.alive);
            }
          } catch {
            // tmux not available — skip liveness
          }
        }

        // Crash recovery: relaunch dead agents (when enabled by paw go)
        if (opts.crashRecovery && paneConfig && tmux) {
          const pc2 = paneConfig; // narrow for closure — paneConfig won't be null here
          const deadActions = findDeadAgents(
            taskNames,
            livenessMap,
            syncState.tasks,
            relaunchCounts,
            MAX_RELAUNCH_ATTEMPTS,
          );
          for (const da of deadActions) {
            if (da.action === 'relaunch') {
              const wt = worktrees.find((w) => w.taskName === da.taskName);
              if (!wt) continue;
              const sessionName = `${pc2.sessionName}-${da.taskName}`;
              killDetachedSession(tmux, sessionName);
              await createDetachedSession(
                tmux,
                sessionName,
                wt.worktreePath,
                opts.crashRecovery.agentCommand,
              );
              relaunchCounts[da.taskName] = (relaunchCounts[da.taskName] ?? 0) + 1;
              const updatedAgents = (pc2.detached ?? []).map((a) =>
                a.taskName === da.taskName ? { ...a, sessionName } : a,
              );
              saveDetachedAgents(repoRoot, pc2.sessionName, updatedAgents);
              printRelaunch(
                da.taskName,
                taskIndex,
                relaunchCounts[da.taskName]!,
                MAX_RELAUNCH_ATTEMPTS,
              );
              deadWarned.delete(da.taskName);
            } else if (da.action === 'max-attempts' && !deadWarned.has(da.taskName)) {
              printMaxAttempts(da.taskName, taskIndex);
              deadWarned.add(da.taskName);
            }
          }
        }

        const checkTime = Date.now();
        for (const name of taskNames) {
          const taskStatus = syncState.tasks[name]?.status;
          if (taskStatus === 'done') continue;

          const alive = livenessMap.get(name);

          // Dead session alert (only warn once, skip if crash recovery handled it)
          if (alive === false && !deadWarned.has(name) && !opts.crashRecovery) {
            printStallWarning(name, taskIndex, 0, false);
            deadWarned.add(name);
            continue;
          }

          // Stall warning (alive but no commits for threshold)
          const elapsed = checkTime - (lastCommitTime[name] ?? checkTime);
          const elapsedMinutes = Math.floor(elapsed / 60_000);
          if (elapsedMinutes >= Math.floor(stallThreshold / 60) && !stallWarned.has(name)) {
            printStallWarning(name, taskIndex, elapsedMinutes, alive !== false);
            stallWarned.add(name);
          }
        }
      }

      // 5. Check if all done
      if (isAllDone(syncState.tasks)) {
        printSummary();
        if (!noExit) {
          break;
        }
      }

      await sleep(interval * 1000);
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  if (aborted) {
    if (onAbort) {
      onAbort();
    } else {
      console.log(pc.dim('\nWatch stopped.'));
    }
  }
}

// --- Command registration ---

export function watchCommand(): Command {
  return new Command('watch')
    .description('Continuously monitor agent progress')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--interval <seconds>', 'Poll interval in seconds', DEFAULT_POLL_INTERVAL)
    .option(
      '--stall-threshold <seconds>',
      'Warn if no commits for this many seconds (0 to disable)',
      DEFAULT_STALL_THRESHOLD,
    )
    .option('--no-exit', 'Keep running after all agents are done')
    .action(
      async (opts: {
        config?: string;
        interval: string;
        stallThreshold: string;
        exit: boolean;
      }) => {
        try {
          const repoRoot = getRepoRoot();
          const configPath = opts.config ?? resolveConfigPath(repoRoot);
          const interval = parseInt(opts.interval, 10);
          const stallThreshold = parseInt(opts.stallThreshold, 10);

          if (isNaN(interval) || interval < 1) {
            console.error(colors.error('Interval must be a positive integer (seconds).'));
            process.exit(1);
          }

          await runWatchLoop({
            repoRoot,
            configPath,
            interval,
            stallThreshold: isNaN(stallThreshold) ? 300 : stallThreshold,
            noExit: !opts.exit,
          });
        } catch (err) {
          handleError(err);
        }
      },
    );
}
