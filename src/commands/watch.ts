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
import { readPaneConfig } from '../lib/pane-state.js';
import {
  checkAgentLiveness,
  createTmuxService,
  sendNudgeKeys,
  buildLivenessMap,
} from '../lib/tmux.js';
import type { PawPaneConfig, TmuxServiceApi } from '../lib/tmux.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { handleError, colors } from '../lib/output.js';
import { sleep } from '../lib/util.js';
import {
  evaluateAllAgents,
  writeNudge,
  writeHealthSnapshot,
  triageAgent,
  saveTriageOutput,
} from '../lib/health.js';
import type { HealthState, HealthSnapshot } from '../lib/health.js';

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

function printHealthTransition(
  taskName: string,
  from: HealthState | undefined,
  to: HealthState,
  taskIndex: Map<string, number>,
): void {
  const name = colorTask(taskName, taskIndex);
  if (to === 'stalled') {
    console.log(`${timestamp()} ${colors.warn('⚠')} ${name} stalled — no activity`);
  } else if (to === 'zombie') {
    console.log(`${timestamp()} ${colors.error('☠')} ${name} zombie — presumed dead`);
  } else if (from === 'stalled' && to === 'working') {
    console.log(`${timestamp()} ${colors.success('↻')} ${name} resumed`);
  } else if (to === 'working' && from === 'booting') {
    console.log(`${timestamp()} ${colors.success('+')} ${name} first heartbeat`);
  }
}

// --- Poll loop ---

function resolveNudgeTarget(paneConfig: PawPaneConfig, taskName: string): string | null {
  if (paneConfig.mode === 'detached' && paneConfig.detached) {
    const agent = paneConfig.detached.find((a) => a.taskName === taskName);
    return agent?.sessionName ?? null;
  }
  const pane = paneConfig.panes.find((p) => p.taskName === taskName);
  return pane?.paneId ?? null;
}

/** Polls sync state, journal, commit counts, and agent health on an interval. */
export async function runWatchLoop(opts: {
  repoRoot: string;
  configPath: string;
  interval: number;
  noExit: boolean;
  header?: string;
  onAbort?: () => void;
}): Promise<void> {
  const { repoRoot, configPath, interval, noExit, onAbort } = opts;
  const config = loadConfig(configPath);
  const worktrees = planWorktrees(config, repoRoot);
  const taskNames = worktrees.map((w) => w.taskName);

  const taskIndex = new Map<string, number>();
  taskNames.forEach((name, i) => taskIndex.set(name, i));

  let lastSeenTs: string | undefined;
  let prevStatuses: Record<string, TaskState['status']> = {};
  let prevCommitCounts: Record<string, number> = {};

  // Health monitoring state
  let prevHealth: HealthSnapshot | null = null;
  const prevHealthStates: Record<string, HealthState> = {};
  const prevEscalationLevels: Record<string, number> = {};

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
      const syncState = readSyncState(repoRoot);
      if (!syncState) {
        console.log(pc.dim(`${timestamp()} No sync state yet, waiting...`));
        await sleep(interval * 1000);
        continue;
      }

      // Diff journal
      const journal = readJournal(repoRoot);
      const journalDiff = diffJournal(journal, lastSeenTs);
      lastSeenTs = journalDiff.lastSeenTs;

      for (const entry of journalDiff.newEntries) {
        printJournalEntry(entry, taskIndex);
      }

      // Diff statuses
      const statusDiff = diffStatuses(prevStatuses, syncState.tasks);
      prevStatuses = statusDiff.currentStatuses;

      for (const t of statusDiff.transitions) {
        printStatusTransition(t, taskIndex);
      }

      // Diff commit counts
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

      // Evaluate agent health (ZFC)
      let livenessMap = new Map<string, boolean>();
      const paneConfig = readPaneConfig(repoRoot);
      let tmux: TmuxServiceApi | null = null;
      if (paneConfig) {
        try {
          tmux = createTmuxService();
          const results = checkAgentLiveness(tmux, paneConfig);
          livenessMap = buildLivenessMap(results);
        } catch {
          // tmux not available — skip liveness
          tmux = null;
        }
      }

      const now = new Date();
      const healthSnapshot = evaluateAllAgents({
        repoRoot,
        taskNames,
        syncTasks: syncState.tasks,
        livenessMap,
        prevHealth,
        now,
      });
      prevHealth = healthSnapshot;
      writeHealthSnapshot(repoRoot, healthSnapshot);

      for (const [taskName, health] of Object.entries(healthSnapshot.agents)) {
        const prevState = prevHealthStates[taskName];
        if (prevState !== health.state) {
          printHealthTransition(taskName, prevState, health.state, taskIndex);
          prevHealthStates[taskName] = health.state;
        }

        // Progressive escalation — act only on level transitions
        const prevLevel = prevEscalationLevels[taskName] ?? 0;
        const currLevel = health.escalationLevel;

        if (health.state === 'stalled' && currLevel > prevLevel) {
          switch (currLevel) {
            case 1: {
              // Level 1: nudge — file + send-keys
              console.log(
                `${timestamp()} ${colors.warn('📩')} ${colorTask(taskName, taskIndex)} nudging stalled agent...`,
              );
              const stalledMs = health.stalledSince
                ? now.getTime() - new Date(health.stalledSince).getTime()
                : 0;
              const stalledMin = Math.floor(stalledMs / 60_000);
              const msg =
                `You appear stalled on task "${taskName}". ` +
                `No tool activity for ${stalledMin}m. ` +
                `If stuck, try a different approach or use paw broadcast to ask for help.`;

              writeNudge(repoRoot, taskName, msg);

              if (paneConfig && tmux) {
                const target = resolveNudgeTarget(paneConfig, taskName);
                if (target) {
                  sendNudgeKeys(tmux, target, msg).catch(() => {});
                }
              }
              break;
            }

            case 2: {
              // Level 2: triage — AI classification
              if (paneConfig && tmux) {
                const target = resolveNudgeTarget(paneConfig, taskName);
                if (target) {
                  console.log(
                    `${timestamp()} ${colors.warn('🔍')} ${colorTask(taskName, taskIndex)} triaging stalled agent...`,
                  );
                  const { verdict, captured } = triageAgent(tmux, target, taskName);
                  saveTriageOutput(repoRoot, taskName, captured, verdict);

                  if (verdict === 'extend') {
                    console.log(
                      `${timestamp()}   ${colorTask(taskName, taskIndex)} triage: EXTEND — resetting escalation`,
                    );
                    health.stalledSince = now.toISOString();
                    health.escalationLevel = 0;
                  } else if (verdict === 'retry') {
                    console.log(
                      `${timestamp()}   ${colorTask(taskName, taskIndex)} triage: RETRY — sending recovery nudge`,
                    );
                    const retryMsg =
                      `You appear stuck on task "${taskName}". ` +
                      `Try a completely different approach, or use paw broadcast to ask for help.`;
                    sendNudgeKeys(tmux, target, retryMsg).catch(() => {});
                  } else {
                    console.log(
                      `${timestamp()} ${colors.error('☠')} ${colorTask(taskName, taskIndex)} triage: TERMINATE — marking zombie`,
                    );
                    health.state = 'zombie';
                    health.escalationLevel = 0;
                    printHealthTransition(taskName, 'stalled', 'zombie', taskIndex);
                    prevHealthStates[taskName] = 'zombie';
                  }
                }
              }
              break;
            }

            default: {
              // Level 3+: terminate — mark zombie
              console.log(
                `${timestamp()} ${colors.error('☠')} ${colorTask(taskName, taskIndex)} escalation reached terminal level — marking zombie`,
              );
              health.state = 'zombie';
              health.escalationLevel = 0;
              health.stalledSince = null;
              printHealthTransition(taskName, 'stalled', 'zombie', taskIndex);
              prevHealthStates[taskName] = 'zombie';
              break;
            }
          }
        }

        prevEscalationLevels[taskName] = health.escalationLevel;
      }

      // Check terminal conditions
      if (isAllDone(syncState.tasks)) {
        printSummary();
        if (!noExit) break;
      } else {
        const allTerminal = Object.values(healthSnapshot.agents).every(
          (h) => h.state === 'zombie' || h.state === 'completed',
        );
        if (allTerminal) {
          console.log(colors.error('All remaining agents are zombies. Manual review required.'));
          if (!noExit) break;
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
    .option('--no-exit', 'Keep running after all agents are done')
    .action(async (opts: { config?: string; interval: string; exit: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const interval = parseInt(opts.interval, 10);

        if (isNaN(interval) || interval < 1) {
          console.error(colors.error('Interval must be a positive integer (seconds).'));
          process.exit(1);
        }

        await runWatchLoop({
          repoRoot,
          configPath,
          interval,
          noExit: !opts.exit,
        });
      } catch (err) {
        handleError(err);
      }
    });
}
