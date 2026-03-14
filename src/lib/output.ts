import { createSemanticColors } from './context.js';

let _colors: ReturnType<typeof createSemanticColors> | null = null;

export function getColors() {
  if (!_colors) _colors = createSemanticColors();
  return _colors;
}

/** Reset cached colors (called after --color flag is parsed). */
export function resetColors(): void {
  _colors = null;
}

/** Semantic color map — respects --color flag and NO_COLOR/FORCE_COLOR env vars. */
export const colors: ReturnType<typeof createSemanticColors> = new Proxy(
  {} as ReturnType<typeof createSemanticColors>,
  {
    get(_, prop: string) {
      return getColors()[prop as keyof ReturnType<typeof createSemanticColors>];
    },
  },
);

/** Extract a human-readable message from an unknown error. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wrap a command action to catch errors and print friendly messages.
 */
export function handleError(err: unknown): never {
  const message = toErrorMessage(err);

  if (message.includes('not a git repository')) {
    console.error(colors.error('Not in a git repository. Run paw from inside a git repo.'));
  } else {
    console.error(colors.error(message));
  }

  process.exit(1);
}

const ICONS = {
  SUCCESS: '✓',
  ERROR: 'x',
  WARN: '!',
  PENDING: '.',
  SKIP: '-',
  UNKNOWN: '?',
} as const;

/** Print a success status line for a task. */
export function success(taskName: string, detail: string): void {
  console.log(`  ${colors.success(ICONS.SUCCESS)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Print an error status line for a task. */
export function error(taskName: string, detail: string): void {
  console.log(`  ${colors.error(ICONS.ERROR)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Print a warning status line for a task. */
export function warn(taskName: string, detail: string): void {
  console.log(`  ${colors.warn(ICONS.WARN)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Print a pending status line for a task. */
export function pending(taskName: string, detail: string): void {
  console.log(`  ${colors.dim(ICONS.PENDING)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Print a skipped status line for a task. */
export function skip(taskName: string, detail: string): void {
  console.log(`  ${colors.dim(ICONS.SKIP)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Print an unknown-state status line for a task. */
export function unknown(taskName: string, detail: string): void {
  console.log(`  ${colors.warn(ICONS.UNKNOWN)} ${colors.bold(taskName)} -- ${detail}`);
}

/** Guard that throws if no sync state is available. */
export function requireSyncState<T>(state: T | null): asserts state is T {
  if (!state) {
    throw new Error('No sync state found. Run `paw up` first.');
  }
}

/** Map task status codes to display strings (e.g. 'in_review' → 'in review'). */
export function formatTaskStatus(status: string): string {
  if (status === 'in_review') return 'in review';
  return status;
}

/** Render focus areas as a compact parenthetical, truncated to keep status lines readable. */
export function formatFocusAreas(focus: string[] | undefined): string {
  if (!focus || focus.length === 0) return '';
  if (focus.length <= 3) return `(${focus.join(', ')})`;
  const remaining = focus.length - 2;
  return `(${focus[0]}, ${focus[1]}, +${remaining} more)`;
}
