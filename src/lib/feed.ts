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

// ── Tool events (emitted by PostToolUse hook) ──────────────────────

export interface ToolReadEvent extends FeedEvent {
  event: 'tool.Read';
  file: string;
}

export interface ToolGlobEvent extends FeedEvent {
  event: 'tool.Glob';
  pattern: string;
  hits: number;
}

export interface ToolGrepEvent extends FeedEvent {
  event: 'tool.Grep';
  pattern: string;
  hits: number;
}

export interface ToolEditEvent extends FeedEvent {
  event: 'tool.Edit';
  file: string;
  lines: number;
}

export interface ToolWriteEvent extends FeedEvent {
  event: 'tool.Write';
  file: string;
}

export interface ToolBashEvent extends FeedEvent {
  event: 'tool.Bash';
  cmd: string;
}

export interface ToolAgentEvent extends FeedEvent {
  event: 'tool.Agent';
  description: string;
}

// ── Bash-derived events ────────────────────────────────────────────

export interface GitCommitEvent extends FeedEvent {
  event: 'git.commit';
  msg: string;
}

// ── Fleet command self-emitted events ──────────────────────────────

export interface FleetBroadcastEvent extends FeedEvent {
  event: 'fleet.broadcast';
  msg: string;
}

export interface FleetSendEvent extends FeedEvent {
  event: 'fleet.send';
  to: string;
  msg: string;
}

export interface FleetReplyEvent extends FeedEvent {
  event: 'fleet.reply';
  to: string;
  msg: string;
}

export interface FleetReviewEvent extends FeedEvent {
  event: 'fleet.review';
  cycle: number;
}

export interface FleetSummaryEvent extends FeedEvent {
  event: 'fleet.summary';
  append: boolean;
}

export interface FleetPrimeEvent extends FeedEvent {
  event: 'fleet.prime';
}

export interface FleetShortcutEvent extends FeedEvent {
  event: 'fleet.shortcut';
  name: string;
}

export interface FleetGuidelineEvent extends FeedEvent {
  event: 'fleet.guideline';
  name: string;
}

export interface FleetTemplateEvent extends FeedEvent {
  event: 'fleet.template';
  name: string;
}

export interface FleetNudgeEvent extends FeedEvent {
  event: 'fleet.nudge';
  to: string;
  msg: string;
}

export interface FleetUpEvent extends FeedEvent {
  event: 'fleet.up';
  target: string;
  tasks: number;
}

export interface FleetLaunchEvent extends FeedEvent {
  event: 'fleet.launch';
  tasks: string[];
}

export interface FleetMergeEvent extends FeedEvent {
  event: 'fleet.merge';
  source: string;
  target: string;
  conflicts: boolean;
  files?: string[];
  continue?: boolean;
}

export interface FleetDownEvent extends FeedEvent {
  event: 'fleet.down';
  archived: string;
}

export interface FleetTriageEvent extends FeedEvent {
  event: 'fleet.triage';
  verdict: 'extend' | 'retry' | 'terminate';
}

// ── Reviewer events ────────────────────────────────────────────────

export interface ReviewStartEvent extends FeedEvent {
  event: 'review.start';
  cycle: number;
}

export interface ReviewVerdictEvent extends FeedEvent {
  event: 'review.verdict';
  verdict: string;
  findings: number;
}

export interface ReviewTimeoutEvent extends FeedEvent {
  event: 'review.timeout';
  elapsed: number;
}

// ── Session bookends ───────────────────────────────────────────────

export interface SessionStartEvent extends FeedEvent {
  event: 'session.start';
  target: string;
  tasks: number;
}

export interface SessionEndEvent extends FeedEvent {
  event: 'session.end';
  tasks_completed: number;
  tasks_failed: number;
  duration_s: number;
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
