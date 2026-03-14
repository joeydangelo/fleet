import pc from 'picocolors';

/** Semantic color map for consistent CLI output. */
export const colors = {
  success: pc.green,
  error: pc.red,
  warn: pc.yellow,
  info: pc.cyan,
  muted: pc.gray,
} as const;

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
  console.log(`  ${colors.success(ICONS.SUCCESS)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Print an error status line for a task. */
export function error(taskName: string, detail: string): void {
  console.error(`  ${colors.error(ICONS.ERROR)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Print a warning status line for a task. */
export function warn(taskName: string, detail: string): void {
  console.error(`  ${colors.warn(ICONS.WARN)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Print a pending status line for a task. */
export function pending(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.PENDING)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Print a skipped status line for a task. */
export function skip(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.SKIP)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Print an unknown-state status line for a task. */
export function unknown(taskName: string, detail: string): void {
  console.error(`  ${colors.warn(ICONS.UNKNOWN)} ${pc.bold(taskName)} -- ${detail}`);
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
