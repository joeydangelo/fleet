import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { Command } from 'commander';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import type { SyncState, TaskState, MergeEntry } from '../lib/sync.js';
import { readMessages } from '../lib/messages.js';
import type { Message } from '../lib/messages.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { tryGetLivenessMap } from '../lib/util.js';
import { formatElapsed } from '../lib/util.js';
import { evaluateAllAgents } from '../lib/health.js';
import type { HealthSnapshot } from '../lib/health.js';
import { readVerdictFile, verdictFilePath } from '../lib/reviewer.js';
import type { ReviewVerdict } from '../lib/reviewer.js';
import { resolveAgentStatus, statusStyle } from '../lib/display-status.js';
import type { AgentDisplayStatus } from '../lib/display-status.js';
import { getVersion } from '../lib/version.js';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants.js';
import { handleError } from '../lib/output.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Format a timestamp as HH:MM:SS AM/PM. */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/** Format relative time from an ISO timestamp to now. */
export function relativeTime(isoTs: string, now: Date): string {
  const ms = now.getTime() - new Date(isoTs).getTime();
  if (ms < 0) return '0s ago';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Format a message for display, truncating if needed. */
export function formatMessage(entry: Message, now: Date, maxLen: number): string {
  const rel = relativeTime(entry.ts, now);
  let prefix: string;
  if (entry.type === 'broadcast') {
    prefix = `${entry.from}:`;
  } else if (entry.type === 'nudge') {
    prefix = `Orchestrator -> ${entry.to ?? ''}:`;
  } else {
    prefix = entry.to ? `${entry.from} -> ${entry.to}:` : `${entry.from}:`;
  }
  const suffix = ` (${rel})`;
  const content = ` ${entry.msg}`;
  const available = maxLen - prefix.length - suffix.length;
  const truncated =
    available > 3 && content.length > available ? content.slice(0, available - 3) + '...' : content;
  return `${prefix}${truncated}${suffix}`;
}

/** Compute duration string from claimed/doneAt timestamps. */
export function computeDuration(task: TaskState, now: Date): string {
  if (!task.claimed) return '';
  const start = new Date(task.claimed).getTime();
  const end = task.doneAt ? new Date(task.doneAt).getTime() : now.getTime();
  return formatElapsed(Math.max(0, end - start));
}

/** Apply a picocolors-style color name to an Ink Text element's color prop. */
function inkColor(color: string): string | undefined {
  if (color === 'dim') return 'gray';
  if (color === 'cyan') return 'cyan';
  if (color === 'green') return 'green';
  if (color === 'yellow') return 'yellow';
  if (color === 'red') return 'red';
  return undefined;
}

/** Map merge entry status to display badge and color. */
export function mergeBadge(status: MergeEntry['status']): { label: string; color: string } {
  switch (status) {
    case 'merged':
      return { label: 'merged', color: 'green' };
    case 'conflict':
      return { label: 'conflict', color: 'red' };
    case 'skipped':
      return { label: 'skipped', color: 'gray' };
    case 'pending':
      return { label: 'pending', color: 'yellow' };
  }
}

// ── Data polling ─────────────────────────────────────────────────────

interface DashboardState {
  syncState: SyncState | null;
  messages: Message[];
  livenessMap: Map<string, boolean>;
  healthSnapshot: HealthSnapshot | null;
  verdicts: Record<string, ReviewVerdict | null>;
  now: Date;
}

function pollState(
  repoRoot: string,
  taskNames: string[],
  taskBranches: Record<string, string>,
  prevHealth: HealthSnapshot | null,
): DashboardState {
  const now = new Date();
  const syncState = readSyncState(repoRoot);
  const messages = readMessages(repoRoot);
  const paneConfig = readPaneConfig(repoRoot);
  const livenessMap = tryGetLivenessMap(paneConfig);

  let healthSnapshot: HealthSnapshot | null = null;
  if (syncState) {
    healthSnapshot = evaluateAllAgents({
      repoRoot,
      taskNames,
      syncTasks: syncState.tasks,
      livenessMap,
      prevHealth,
      now,
    });
  }

  const verdicts: Record<string, ReviewVerdict | null> = {};
  for (const taskName of taskNames) {
    const branch = taskBranches[taskName];
    if (branch) {
      const vPath = verdictFilePath(repoRoot, branch);
      const result = readVerdictFile(vPath);
      verdicts[taskName] = result?.verdict ?? null;
    }
  }

  return { syncState, messages, livenessMap, healthSnapshot, verdicts, now };
}

// ── Ink Components ───────────────────────────────────────────────────

function HeaderBar({ version, now, interval }: { version: string; now: Date; interval: number }) {
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text bold>fleet dashboard v{version}</Text>
      <Text>
        {formatTime(now)} | refresh: {interval * 1000}ms
      </Text>
    </Box>
  );
}

function HRule() {
  return <Text dimColor>{'─'.repeat(80)}</Text>;
}

function AgentsPanel({
  taskNames,
  syncState,
  healthSnapshot,
  livenessMap,
  verdicts,
  now,
}: {
  taskNames: string[];
  syncState: SyncState | null;
  healthSnapshot: HealthSnapshot | null;
  livenessMap: Map<string, boolean>;
  verdicts: Record<string, ReviewVerdict | null>;
  now: Date;
}) {
  const count = taskNames.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Agents ({count})</Text>
      <Box>
        <Text dimColor>{'  St  Name             Status        Review   Duration   Tmux'}</Text>
      </Box>
      {taskNames.map((name) => {
        const task = syncState?.tasks[name];
        const health = healthSnapshot?.agents[name];
        const displayStatus: AgentDisplayStatus = task
          ? resolveAgentStatus(task.status, health?.state)
          : 'pending';
        const style = statusStyle(displayStatus);
        const verdict = verdicts[name];
        const duration = task ? computeDuration(task, now) : '';
        const tmuxAlive = livenessMap.get(name);

        return (
          <Box key={name}>
            <Text>{'  '}</Text>
            <Box width={4}>
              <Text color={inkColor(style.color)}>{style.icon}</Text>
            </Box>
            <Box width={17}>
              <Text>{name.length > 15 ? name.slice(0, 15) + '…' : name}</Text>
            </Box>
            <Box width={14}>
              <Text color={inkColor(style.color)}>{displayStatus}</Text>
            </Box>
            <Box width={9}>
              {verdict === 'pass' && <Text color="green">PASS</Text>}
              {verdict === 'fail' && <Text color="red">FAIL</Text>}
              {verdict === 'skip' && <Text dimColor>SKIP</Text>}
            </Box>
            <Box width={11}>
              <Text>{duration}</Text>
            </Box>
            <Box width={4}>{tmuxAlive === true && <Text color="green">●</Text>}</Box>
          </Box>
        );
      })}
    </Box>
  );
}

function MailPanel({ messages, now }: { messages: Message[]; now: Date }) {
  const recent = messages.slice(-5).reverse();
  return (
    <Box flexDirection="column" paddingX={1} width="50%">
      <Text bold>Mail ({messages.length})</Text>
      {recent.length === 0 && <Text dimColor>No messages</Text>}
      {recent.map((msg, i) => (
        <Text key={i} wrap="truncate">
          {formatMessage(msg, now, 70)}
        </Text>
      ))}
    </Box>
  );
}

function MergeQueuePanel({
  merges,
  target,
}: {
  merges: Record<string, MergeEntry>;
  target: string;
}) {
  const entries = Object.entries(merges);
  return (
    <Box flexDirection="column" paddingX={1} width="50%">
      <Text bold>Merge Queue ({entries.length})</Text>
      {entries.length === 0 && <Text dimColor>No merges</Text>}
      {entries.map(([taskName, entry]) => {
        const badge = mergeBadge(entry.status);
        return (
          <Box key={taskName} gap={1}>
            <Box width={10}>
              <Text color={inkColor(badge.color)}>{badge.label}</Text>
            </Box>
            <Box width={15}>
              <Text>{taskName}</Text>
            </Box>
            <Text dimColor>{target}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function Dashboard({
  repoRoot,
  taskNames,
  taskBranches,
  target,
  interval,
  version,
}: {
  repoRoot: string;
  taskNames: string[];
  taskBranches: Record<string, string>;
  target: string;
  interval: number;
  version: string;
}) {
  const { exit } = useApp();
  const [state, setState] = useState<DashboardState>({
    syncState: null,
    messages: [],
    livenessMap: new Map(),
    healthSnapshot: null,
    verdicts: {},
    now: new Date(),
  });

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  useEffect(() => {
    let prevHealth: HealthSnapshot | null = null;

    const poll = () => {
      const next = pollState(repoRoot, taskNames, taskBranches, prevHealth);
      prevHealth = next.healthSnapshot;
      setState(next);
    };

    poll(); // initial
    const id = setInterval(poll, interval * 1000);
    return () => clearInterval(id);
  }, [repoRoot, taskNames, taskBranches, interval]);

  return (
    <Box flexDirection="column">
      <HeaderBar version={version} now={state.now} interval={interval} />
      <HRule />
      <AgentsPanel
        taskNames={taskNames}
        syncState={state.syncState}
        healthSnapshot={state.healthSnapshot}
        livenessMap={state.livenessMap}
        verdicts={state.verdicts}
        now={state.now}
      />
      <HRule />
      <Box>
        <MailPanel messages={state.messages} now={state.now} />
        <MergeQueuePanel merges={state.syncState?.merges ?? {}} target={target} />
      </Box>
    </Box>
  );
}

// ── Command ──────────────────────────────────────────────────────────

export function dashboardCommand(): Command {
  return new Command('dashboard')
    .description('Terminal dashboard for fleet sessions')
    .option('--interval <seconds>', 'Poll interval in seconds', String(DEFAULT_POLL_INTERVAL))
    .action((opts: { interval: string }) => {
      try {
        const { repoRoot, config } = loadRepoConfig();
        const interval = parseInt(opts.interval, 10) || DEFAULT_POLL_INTERVAL;
        const worktrees = planWorktrees(config, repoRoot);
        const taskNames = worktrees.map((w) => w.taskName);
        const taskBranches: Record<string, string> = {};
        for (const w of worktrees) {
          taskBranches[w.taskName] = w.branch;
        }
        const version = getVersion();

        render(
          <Dashboard
            repoRoot={repoRoot}
            taskNames={taskNames}
            taskBranches={taskBranches}
            target={config.target}
            interval={interval}
            version={version}
          />,
          { exitOnCtrlC: true },
        );
      } catch (err) {
        handleError(err);
      }
    });
}
