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
import { createTmuxService, sendWakeSignal } from '../lib/tmux.js';
import type { TmuxServiceApi } from '../lib/tmux.js';
import { sleep, tryGetLivenessMap } from '../lib/util.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { handleError, colors, COLOR_PALETTE } from '../lib/output.js';
import {
  evaluateAllAgents,
  writeHealthSnapshot,
  triageAgent,
  saveTriageOutput,
} from '../lib/health.js';
import type { HealthState, HealthSnapshot } from '../lib/health.js';

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
  verdict?: string;
  reviewCycle?: number;
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
      transitions.push({
        task,
        from: prevStatus,
        to: state.status,
        verdict: state.verdict,
        reviewCycle: state.reviewCycle,
      });
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

function printMessage(entry: Message, taskIndex: Map<string, number>, prefix = ''): void {
  const from = colorTask(entry.from, taskIndex);

  if (entry.type === 'broadcast') {
    console.log(`${prefix}${timestamp()}   ${from} broadcast: ${entry.msg}`);
  } else if (entry.to) {
    const to = colorTask(entry.to, taskIndex);
    console.log(`${prefix}${timestamp()}   ${from} → ${to}: ${entry.msg}`);
  } else {
    console.log(`${prefix}${timestamp()}   ${from}: ${entry.msg}`);
  }
}

function printStatusTransition(
  t: StatusTransition,
  taskIndex: Map<string, number>,
  prefix = '',
): void {
  const name = colorTask(t.task, taskIndex);

  if (t.from === undefined) {
    // New task appearing -- skip silent "pending" entries on first poll
    return;
  }

  switch (t.to) {
    case 'in_progress':
      if (t.from === 'in_review') {
        console.log(`${prefix}${timestamp()} ${colors.error('✗')} ${name} review failed — fixing`);
      } else {
        console.log(`${prefix}${timestamp()} ${colors.success('+')} ${name} claimed task`);
      }
      break;
    case 'in_review': {
      const cycle = t.reviewCycle ?? 0;
      const suffix = cycle > 1 ? ` (attempt ${cycle})` : '';
      console.log(
        `${prefix}${timestamp()} ${colors.info('⟳')} ${name} submitted for review${suffix}`,
      );
      break;
    }
    case 'done':
      console.log(`${prefix}${timestamp()} ${colors.success('✓')} ${name} done`);
      break;
    case 'pending':
      break;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function printCommitDelta(
  d: CommitDelta,
  taskIndex: Map<string, number>,
  fileCount?: number,
  prefix = '',
): void {
  const name = colorTask(d.task, taskIndex);
  const delta = d.to - d.from;
  const filesStr = fileCount !== undefined ? `, ${plural(fileCount, 'file')}` : '';
  console.log(
    `${prefix}${timestamp()}   ${name} +${plural(delta, 'commit')} (${d.to} total${filesStr})`,
  );
}

function printSummary(prefix = ''): void {
  console.log(`${prefix}${timestamp()} All agents done.`);
}

function printHealthTransition(
  taskName: string,
  from: HealthState | undefined,
  to: HealthState,
  taskIndex: Map<string, number>,
  prefix = '',
): void {
  const name = colorTask(taskName, taskIndex);
  if (to === 'stalled') {
    console.log(`${prefix}${timestamp()} ${colors.warn('⚠')} ${name} stalled — no activity`);
  } else if (to === 'zombie') {
    console.log(`${prefix}${timestamp()} ${colors.error('☠')} ${name} zombie — presumed dead`);
  } else if (from === 'stalled' && to === 'working') {
    console.log(`${prefix}${timestamp()} ${colors.success('↻')} ${name} resumed`);
  }
}

/** Polls sync state, messages, commit counts, and agent health on an interval. */
export async function runWatchLoop(opts: {
  repoRoot: string;
  configPath: string;
  interval: number;
  header?: string;
  linePrefix?: string;
  onAbort?: () => void;
}): Promise<void> {
  const { repoRoot, configPath, interval, onAbort } = opts;
  const prefix = opts.linePrefix ?? '';
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
    if (opts.header !== '') console.log(opts.header);
  } else {
    console.log(
      pc.bold('fleet watch') + pc.dim(` (polling every ${interval}s, ${taskNames.length} task(s))`),
    );
    console.log(pc.dim(`Tasks: ${taskNames.map((n, i) => assignColor(i)(n)).join(', ')}`));
    console.log();
  }

  try {
    while (!aborted) {
      const syncState = readSyncState(repoRoot);
      if (!syncState) {
        console.log(`${prefix}${pc.dim(`${timestamp()} No sync state yet, waiting...`)}`);
        await sleep(interval * 1000);
        continue;
      }

      const messages = readMessages(repoRoot);
      const messageDiff = diffMessages(messages, lastSeenTs);
      lastSeenTs = messageDiff.lastSeenTs;

      for (const entry of messageDiff.newEntries) {
        printMessage(entry, taskIndex, prefix);
      }

      const statusDiff = diffStatuses(prevStatuses, syncState.tasks);
      prevStatuses = statusDiff.currentStatuses;

      for (const t of statusDiff.transitions) {
        printStatusTransition(t, taskIndex, prefix);
      }

      const currentCommitCounts: Record<string, number> = {};
      for (const wt of worktrees) {
        try {
          currentCommitCounts[wt.taskName] = getCommitCount(wt.branch, config.target, repoRoot);
        } catch {
          // Commit count is cosmetic — transient git errors (e.g. mid-rebase)
          // resolve on the next poll cycle without user intervention.
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
        printCommitDelta(d, taskIndex, fileCount, prefix);
      }

      // Runs after review refresh so health sees up-to-date sync state
      const paneConfig = readPaneConfig(repoRoot);
      const livenessMap = tryGetLivenessMap(paneConfig);
      let tmux: TmuxServiceApi | null = null;
      if (paneConfig) {
        try {
          tmux = createTmuxService();
        } catch {
          // tmux not available — skip wake signals
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

      for (const [taskName, healthSnapshot_] of Object.entries(healthSnapshot.agents)) {
        // Shallow-copy to avoid mutating the snapshot that prevHealth references
        const health = { ...healthSnapshot_ };
        const prevState = prevHealthStates[taskName];
        if (prevState !== health.state) {
          printHealthTransition(taskName, prevState, health.state, taskIndex, prefix);
          prevHealthStates[taskName] = health.state;
        }

        // Progressive escalation — act only on level transitions
        const prevLevel = prevEscalationLevels[taskName] ?? 0;
        const currLevel = health.escalationLevel;

        if (health.state === 'stalled' && currLevel > prevLevel) {
          const name = colorTask(taskName, taskIndex);

          switch (currLevel) {
            case 1: {
              console.log(
                `${prefix}${timestamp()} ${colors.warn('→')} ${name} nudging stalled agent`,
              );
              const stalledMs = health.stalledSince
                ? now.getTime() - new Date(health.stalledSince).getTime()
                : 0;
              const stalledMin = Math.floor(stalledMs / 60_000);
              const msg =
                `You appear stalled on task "${taskName}". ` +
                `No tool activity for ${stalledMin}m. ` +
                `If stuck, try a different approach or use fleet broadcast to ask for help.`;

              appendMessage('orchestrator', {
                type: 'nudge',
                to: taskName,
                msg,
              });

              if (paneConfig && tmux) {
                const target = resolvePaneTarget(paneConfig, taskName);
                if (target) sendWakeSignal(tmux, target);
              }
              break;
            }

            case 2: {
              if (paneConfig && tmux) {
                const target = resolvePaneTarget(paneConfig, taskName);
                if (target) {
                  console.log(
                    `${prefix}${timestamp()} ${colors.warn('⚠')} ${name} triaging stalled agent`,
                  );
                  const { verdict, captured } = triageAgent(tmux, target, taskName);
                  saveTriageOutput(repoRoot, taskName, captured, verdict, new Date().toISOString());

                  if (verdict === 'extend') {
                    console.log(
                      `${prefix}${timestamp()}   ${name} triage: extending — activity detected`,
                    );
                    health.stalledSince = now.toISOString();
                    health.escalationLevel = 0;
                  } else if (verdict === 'retry') {
                    console.log(
                      `${prefix}${timestamp()}   ${name} triage: retrying — sending recovery nudge`,
                    );
                    const retryMsg =
                      `You appear stuck on task "${taskName}". ` +
                      `Try a completely different approach, or use fleet broadcast to ask for help.`;
                    appendMessage('orchestrator', {
                      type: 'nudge',
                      to: taskName,
                      msg: retryMsg,
                    });
                    sendWakeSignal(tmux, target);
                  } else {
                    console.log(`${prefix}${timestamp()}   ${name} triage: terminating`);
                    health.state = 'zombie';
                    health.escalationLevel = 0;
                    printHealthTransition(taskName, 'stalled', 'zombie', taskIndex, prefix);
                    prevHealthStates[taskName] = 'zombie';
                  }
                }
              }
              break;
            }

            // currLevel is bounded by MAX_ESCALATION_LEVEL; levels above case 2 are terminal.
            default: {
              health.state = 'zombie';
              health.escalationLevel = 0;
              health.stalledSince = null;
              printHealthTransition(taskName, 'stalled', 'zombie', taskIndex, prefix);
              prevHealthStates[taskName] = 'zombie';
              break;
            }
          }
        }

        prevEscalationLevels[taskName] = health.escalationLevel;
      }

      writeHealthSnapshot(repoRoot, healthSnapshot);

      if (isAllDone(syncState.tasks)) {
        printSummary(prefix);
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
          console.log(
            `${prefix}${colors.error('All remaining agents are zombies. Manual review required.')}`,
          );
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

/** Build the `fleet watch` CLI command. */
export function watchCommand(): Command {
  return new Command('watch')
    .description('Continuously monitor agent progress')
    .action(async () => {
      try {
        const { repoRoot, configPath } = loadRepoConfig();
        const interval = DEFAULT_POLL_INTERVAL;

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
