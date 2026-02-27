import { AGENT_NAMES } from './tmux.js';
import type { AgentName } from './tmux.js';
import type { TaskState, MergeEntry } from './sync.js';
import type { HealthState } from './health.js';
import { SIDEBAR_WIDTH } from './constants.js';

export { SIDEBAR_WIDTH };

/** Task status as shown in the TUI left panel. */
export type TuiStatus = 'pending' | 'in_progress' | 'done' | 'conflict' | 'stalled' | 'zombie';

const AGENT_BADGES: Record<AgentName, string> = {
  claude: '[cc]',
  codex: '[cx]',
  opencode: '[oc]',
  gemini: '[gm]',
};

const KNOWN_AGENTS = new Set<string>(AGENT_NAMES);
const KNOWN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'ksh', 'tcsh', 'csh']);

/**
 * Returns a display badge for a pane's currently running command.
 * Handles shells (bash, zsh, fish, …), known agents (claude → [cc]), and unknowns.
 */
export function commandBadge(command: string): string {
  const cmd = (command || '').toLowerCase().split('/').pop() ?? '';
  if (KNOWN_SHELLS.has(cmd)) return `[${cmd}]`;
  if (KNOWN_AGENTS.has(cmd)) return AGENT_BADGES[cmd as AgentName];
  if (cmd) return `[${cmd.substring(0, 4)}]`;
  return '[sh]';
}

/**
 * Derives the TUI display status for a task from its sync state and merge entry.
 * Conflict takes precedence: a done task with a conflict merge entry shows as conflict.
 */
export function taskDisplayStatus(
  task: TaskState | undefined,
  merge: MergeEntry | undefined,
  health?: HealthState,
): TuiStatus {
  if (merge?.status === 'conflict') return 'conflict';
  if (health === 'zombie') return 'zombie';
  if (health === 'stalled') return 'stalled';
  return task?.status ?? 'pending';
}

export function statusIcon(status: TuiStatus): { icon: string; color: string } {
  switch (status) {
    case 'in_progress':
      return { icon: '✻', color: 'cyan' };
    case 'done':
      return { icon: '✓', color: 'green' };
    case 'conflict':
      return { icon: '✗', color: 'red' };
    case 'stalled':
      return { icon: '⚠', color: 'yellow' };
    case 'zombie':
      return { icon: '☠', color: 'red' };
    case 'pending':
      return { icon: '◌', color: 'gray' };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled TUI status: ${String(_exhaustive)}`);
    }
  }
}
