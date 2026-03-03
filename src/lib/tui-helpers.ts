import type { TaskState, MergeEntry } from './sync.js';
import type { HealthState } from './health.js';

/** Task status as shown in the TUI left panel. */
export type TuiStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'conflict'
  | 'stalled'
  | 'zombie';

const KNOWN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'ksh', 'tcsh', 'csh']);

/**
 * Returns a display badge for a pane's currently running command.
 * Handles shells (bash, zsh, fish, …), claude ([cc]), and unknowns.
 */
export function commandBadge(command: string): string {
  const cmd = (command || '').toLowerCase().split('/').pop() ?? '';
  if (KNOWN_SHELLS.has(cmd)) return `[${cmd}]`;
  if (cmd === 'claude') return '[cc]';
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

/** Map a TUI status to its display icon and color for the sidebar. */
export function statusIcon(status: TuiStatus): { icon: string; color: string } {
  switch (status) {
    case 'in_progress':
      return { icon: '✻', color: 'cyan' };
    case 'in_review':
      return { icon: '⟳', color: 'blue' };
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
      const exhaustive: never = status;
      throw new Error(`Unhandled TUI status: ${String(exhaustive)}`);
    }
  }
}
