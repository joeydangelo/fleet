import { writeFileSync, mkdirSync, openSync, closeSync, constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { resolveMainRoot } from './git.js';
import { getTaskIdentity } from './session.js';

/** Base event shape — every NDJSON line has these three fields plus variable extras. */
export interface FeedEvent {
  /** Wall-clock timestamp, HH:MM:SS */
  ts: string;
  /** Agent or orchestrator that produced the event */
  task: string;
  /** Dotted category name (e.g. tool.Read, fleet.broadcast, review.verdict) */
  event: string;
  /** Variable extra fields per event type */
  [key: string]: unknown;
}

/** Input to emitEvent — event field is required, task and ts are auto-populated. */
export type EmitEventInput = Omit<FeedEvent, 'ts' | 'task'> & {
  task?: string;
};

/** Format current time as HH:MM:SS. */
export function formatTimestamp(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Default feed file path relative to a repo root. */
export const FEED_FILENAME = 'feed.ndjson';
export const FEED_DIR = '.fleet/run';

/** Resolve the full path to the feed file, always in the main repo root. */
export function getFeedPath(cwd: string): string {
  return resolve(cwd, FEED_DIR, FEED_FILENAME);
}

/**
 * Append one NDJSON event line to `.fleet/run/feed.ndjson`.
 *
 * Resolves to the main repo root so events from worktrees land in the
 * shared feed file that `fleet feed` tails.
 *
 * - Auto-detects task name via getTaskIdentity() if not provided.
 * - Creates `.fleet/run/` if it doesn't exist.
 * - Uses O_APPEND for atomic appends (POSIX guarantee under PIPE_BUF).
 */
export function emitEvent(input: EmitEventInput, cwd: string = process.cwd()): void {
  const mainRoot = resolveMainRoot(cwd);
  const feedPath = getFeedPath(mainRoot);
  const dir = dirname(feedPath);
  mkdirSync(dir, { recursive: true });

  const event: Record<string, unknown> = {
    ...input,
    ts: formatTimestamp(),
    task: input.task ?? getTaskIdentity(cwd),
  };

  const line = JSON.stringify(event) + '\n';

  // O_WRONLY | O_CREAT | O_APPEND — atomic for writes under PIPE_BUF (4KB Linux)
  const fd = openSync(feedPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o644);
  try {
    writeFileSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
