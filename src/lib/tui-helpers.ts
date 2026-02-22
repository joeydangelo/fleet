import type { AgentName } from './tmux.js';
import type { TaskState, MergeEntry } from './sync.js';

/** Task status as shown in the TUI left panel. */
export type TuiStatus = 'pending' | 'in_progress' | 'done' | 'conflict';

const AGENT_BADGES: Record<AgentName, string> = {
  claude: '[cc]',
  codex: '[cx]',
  opencode: '[oc]',
  gemini: '[gm]',
};

const KNOWN_AGENTS = new Set<string>(['claude', 'codex', 'opencode', 'gemini']);

/** Returns the short display badge for an agent name. */
export function agentBadge(agent: string): string {
  if (KNOWN_AGENTS.has(agent)) {
    return AGENT_BADGES[agent as AgentName];
  }
  return '[??]';
}

/**
 * Derives the TUI display status for a task from its sync state and merge entry.
 * Conflict takes precedence: a done task with a conflict merge entry shows as conflict.
 */
export function taskDisplayStatus(
  task: TaskState | undefined,
  merge: MergeEntry | undefined,
): TuiStatus {
  if (merge?.status === 'conflict') return 'conflict';
  return task?.status ?? 'pending';
}

/** Returns the status icon and color for TUI rendering. */
export function statusIcon(status: TuiStatus): { icon: string; color: string } {
  switch (status) {
    case 'in_progress':
      return { icon: '✻', color: 'cyan' };
    case 'done':
      return { icon: '✓', color: 'green' };
    case 'conflict':
      return { icon: '✗', color: 'red' };
    case 'pending':
      return { icon: '◌', color: 'gray' };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled TUI status: ${String(_exhaustive)}`);
    }
  }
}
