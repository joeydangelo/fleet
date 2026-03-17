import type { HealthState } from './health.js';
import type { TaskState } from './sync.js';

export type AgentDisplayStatus =
  | 'pending'
  | 'booting'
  | 'working'
  | 'stalled'
  | 'zombie'
  | 'in review'
  | 'done';

export function resolveAgentStatus(
  taskStatus: TaskState['status'],
  healthState: HealthState | undefined,
): AgentDisplayStatus {
  switch (taskStatus) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      switch (healthState) {
        case 'booting':
          return 'booting';
        case 'working':
          return 'working';
        case 'stalled':
          return 'stalled';
        case 'zombie':
          return 'zombie';
        default:
          return 'working';
      }
    case 'in_review':
      return 'in review';
    case 'done':
      return 'done';
  }
}

export function statusStyle(status: AgentDisplayStatus): { icon: string; color: string } {
  switch (status) {
    case 'pending':
      return { icon: '◌', color: 'dim' };
    case 'booting':
      return { icon: '◌', color: 'dim' };
    case 'working':
      return { icon: '●', color: 'green' };
    case 'stalled':
      return { icon: '●', color: 'yellow' };
    case 'zombie':
      return { icon: '●', color: 'red' };
    case 'in review':
      return { icon: '⟳', color: 'cyan' };
    case 'done':
      return { icon: '✓', color: 'green' };
  }
}
