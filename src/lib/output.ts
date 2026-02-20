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

export function success(taskName: string, detail: string): void {
  console.log(`  ${colors.success(ICONS.SUCCESS)} ${pc.bold(taskName)} -- ${detail}`);
}

export function error(taskName: string, detail: string): void {
  console.log(`  ${colors.error(ICONS.ERROR)} ${pc.bold(taskName)} -- ${detail}`);
}

export function warn(taskName: string, detail: string): void {
  console.log(`  ${colors.warn(ICONS.WARN)} ${pc.bold(taskName)} -- ${detail}`);
}

export function pending(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.PENDING)} ${pc.bold(taskName)} -- ${detail}`);
}

export function skip(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.SKIP)} ${pc.bold(taskName)} -- ${detail}`);
}

export function unknown(taskName: string, detail: string): void {
  console.log(`  ${colors.warn(ICONS.UNKNOWN)} ${pc.bold(taskName)} -- ${detail}`);
}

/** Guard that exits with an error if no sync state is available. */
export function requireSyncState<T>(state: T | null): asserts state is T {
  if (!state) {
    console.error(colors.error('No sync state found. Run `paw up` first.'));
    process.exit(1);
  }
}

/**
 * Format focus areas for display. Shows up to 3 items.
 * If more than 3, shows the first 2 and "+N more".
 * Returns empty string if no focus areas.
 */
export function formatFocusAreas(focus: string[] | undefined): string {
  if (!focus || focus.length === 0) return '';
  if (focus.length <= 3) return `(${focus.join(', ')})`;
  const remaining = focus.length - 2;
  return `(${focus[0]}, ${focus[1]}, +${remaining} more)`;
}
