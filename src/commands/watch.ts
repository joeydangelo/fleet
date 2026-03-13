import { Command } from 'commander';
import pc from 'picocolors';
import type { Formatter } from 'picocolors/types.js';
import { getCommitCount, getChangedFileCount } from '../lib/git.js';
import { loadConfig, loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState, isTerminalStatus } from '../lib/sync.js';
import type { TaskState } from '../lib/sync.js';
import { readMessages, appendMessage } from '../lib/messages.js';
import type { Message } from '../lib/messages.js';
import { readPaneConfig, resolvePaneTarget } from '../lib/pane-state.js';
import {
  checkAgentLiveness,
  createTmuxService,
  sendWakeSignal,
  buildLivenessMap,
} from '../lib/tmux.js';
import type { TmuxServiceApi } from '../lib/tmux.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { handleError, colors } from '../lib/output.js';
import { sleep } from '../lib/util.js';
import {
  evaluateAllAgents,
  writeHealthSnapshot,
  triageAgent,
  saveTriageOutput,
} from '../lib/health.js';
import type { HealthState, HealthSnapshot } from '../lib/health.js';

const COLOR_PALETTE: Formatter[] = [pc.blue, pc.green, pc.yellow, pc.magenta, pc.cyan, pc.red];

function assignColor(index: number): Formatter {
  return COLOR_PALETTE[index % COLOR_PALETTE.length]!;
}

interface MessageDiff {
  newEntries: Message[];
  lastSeenTs: string | undefined;
}

/** Return new messages since `lastSeenTs` and the updated cursor. */
export function diffMessages(entries: Message[], lastSeenTs: string | undefined): MessageDiff {
  if (entries.length === 0) {
    return { newEntries: [], lastSeenTs };
  }

  const newEntries = lastSeenTs ? entries.filter((e) => e.ts > lastSeenTs) : entries;

  const maxTs = entries[entries.length - 1]!.ts;
  // Cursor advances monotonically: when newEntries is empty, all entries
  // have ts <= lastSeenTs, so maxTs <= lastSeenTs. Keeping lastSeenTs
  // avoids regressing the cursor below its current position.
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

/** Detect task status transitions between two poll cycles. */
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

/** Detect per-task commit count changes between two poll cycles. */
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
  return entries.every((t) => isTerminalStatus(t.status));
}

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

function printMessage(entry: Message, taskIndex: Map<string, number>): void {
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

  if (t.from === undefined) {
    // New task appearing -- skip silent "pending" entries on first poll
    return;
  }

  switch (t.to) {
    case 'in_progress':
      console.log(`${timestamp()} ${colors.success('+')} ${name} claimed task`);
      break;
    case 'in_review':
      console.log(`${timestamp()} ${colors.info('⟳')} ${name} submitted for review`);
      break;
    case 'done':
      console.log(`${timestamp()} ${colors.success('✓')} ${name} done`);
      break;
    case 'pending':
      console.log(`${timestamp()}   ${name} ${t.from} → ${t.to}`);
      break;
    default: {
      const exhaustive: never = t.to;
      console.log(`${timestamp()}   ${name} ${t.from} → ${String(exhaustive)}`);
    }
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

/** Polls sync state, messages, commit counts, and agent health on an interval. */
export async function runWatchLoop(opts: {
  repoRoot: string;
  configPath: string;
  interval: number;
  header?: string;
  onAbort?: () => void;
}): Promise<void> {
  const { repoRoot, configPath, interval, onAbort } = opts;
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

      const messages = readMessages(repoRoot);
      const messageDiff = diffMessages(messages, lastSeenTs);
      lastSeenTs = messageDiff.lastSeenTs;

      for (const entry of messageDiff.newEntries) {
        printMessage(entry, taskIndex);
      }

      const statusDiff = diffStatuses(prevStatuses, syncState.tasks);
      prevStatuses = statusDiff.currentStatuses;

      for (const t of statusDiff.transitions) {
        printStatusTransition(t, taskIndex);
      }

      const currentCommitCounts: Record<string, number> = {};
      for (const wt of worktrees) {
        try {
          currentCommitCounts[wt.taskName] = getCommitCount(wt.branch, config.target, repoRoot);
        } catch (err) {
          console.warn(`Failed to get commit count for ${wt.taskName}: ${String(err)}`);
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
          // File count is cosmetic display data — failure does not affect merge logic,
          // so silent skip is acceptable here.
        }
        printCommitDelta(d, taskIndex, fileCount);
      }

      // Runs after review refresh so health sees up-to-date sync state
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

              appendMessage('orchestrator', {
                type: 'nudge',
                to: taskName,
                msg,
              });

              if (paneConfig && tmux) {
                const target = resolvePaneTarget(paneConfig, taskName);
                if (target && !sendWakeSignal(tmux, target)) {
                  console.log(
                    pc.dim(
                      `${timestamp()}   wake signal failed for ${colorTask(taskName, taskIndex)}`,
                    ),
                  );
                }
              }
              break;
            }

            case 2: {
              if (paneConfig && tmux) {
                const target = resolvePaneTarget(paneConfig, taskName);
                if (target) {
                  console.log(
                    `${timestamp()} ${colors.warn('🔍')} ${colorTask(taskName, taskIndex)} triaging stalled agent...`,
                  );
                  const { verdict, captured } = triageAgent(tmux, target, taskName);
                  saveTriageOutput(repoRoot, taskName, captured, verdict, new Date().toISOString());

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
                    appendMessage('orchestrator', {
                      type: 'nudge',
                      to: taskName,
                      msg: retryMsg,
                    });
                    if (!sendWakeSignal(tmux, target)) {
                      console.log(
                        pc.dim(
                          `${timestamp()}   wake signal failed for ${colorTask(taskName, taskIndex)}`,
                        ),
                      );
                    }
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

      writeHealthSnapshot(repoRoot, healthSnapshot);

      if (isAllDone(syncState.tasks)) {
        printSummary();
        break;
      } else {
        // Only exit when every non-done task is a genuine zombie.
        // Tasks in_review have health 'completed' (no escalation needed)
        // but will resolve on their own — don't treat them as terminal.
        const nonDoneNames = taskNames.filter((n) => syncState.tasks[n]?.status !== 'done');
        const allNonDoneZombie =
          nonDoneNames.length > 0 &&
          nonDoneNames.every((n) => healthSnapshot.agents[n]?.state === 'zombie');
        if (allNonDoneZombie) {
          console.log(colors.error('All remaining agents are zombies. Manual review required.'));
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

/** Build the `paw watch` CLI command. */
export function watchCommand(): Command {
  return new Command('watch')
    .description('Continuously monitor agent progress')
    .action(async () => {
      try {
        const { repoRoot, configPath } = loadRepoConfig();
        const interval = parseInt(DEFAULT_POLL_INTERVAL, 10);

        await runWatchLoop({
          repoRoot,
          configPath,
          interval,
        });
      } catch (err) {
        handleError(err);
      }
    });
}
