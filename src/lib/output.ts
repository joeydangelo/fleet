import pc from "picocolors";

/**
 * Wrap a command action to catch errors and print friendly messages.
 */
export function handleError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("not a git repository")) {
    console.error(
      pc.red("Not in a git repository. Run paw from inside a git repo."),
    );
  } else {
    console.error(pc.red(message));
  }

  process.exit(1);
}

export const ICONS = {
  SUCCESS: "+",
  ERROR: "x",
  WARN: "!",
  PENDING: ".",
  SKIP: "-",
  UNKNOWN: "?",
} as const;

export function success(taskName: string, detail: string): void {
  console.log(`  ${pc.green(ICONS.SUCCESS)} ${pc.bold(taskName)} -- ${detail}`);
}

export function error(taskName: string, detail: string): void {
  console.log(`  ${pc.red(ICONS.ERROR)} ${pc.bold(taskName)} -- ${detail}`);
}

export function warn(taskName: string, detail: string): void {
  console.log(`  ${pc.yellow(ICONS.WARN)} ${pc.bold(taskName)} -- ${detail}`);
}

export function pending(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.PENDING)} ${pc.bold(taskName)} -- ${detail}`);
}

export function skip(taskName: string, detail: string): void {
  console.log(`  ${pc.dim(ICONS.SKIP)} ${pc.bold(taskName)} -- ${detail}`);
}

export function unknown(taskName: string, detail: string): void {
  console.log(
    `  ${pc.yellow(ICONS.UNKNOWN)} ${pc.bold(taskName)} -- ${detail}`,
  );
}

/**
 * Format focus areas for display. Shows up to 3 items.
 * If more than 3, shows the first 2 and "+N more".
 * Returns empty string if no focus areas.
 */
export function formatFocusAreas(focus: string[] | undefined): string {
  if (!focus || focus.length === 0) return "";
  if (focus.length <= 3) return `(${focus.join(", ")})`;
  const remaining = focus.length - 2;
  return `(${focus[0]}, ${focus[1]}, +${remaining} more)`;
}
