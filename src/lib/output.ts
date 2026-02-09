import pc from "picocolors";

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
  console.log(`  ${pc.yellow(ICONS.UNKNOWN)} ${pc.bold(taskName)} -- ${detail}`);
}
