/**
 * Event feed emitter — stub for concurrent development.
 * Real implementation provided by the emitter task.
 */

/** Fields for a feed event. `ts` and `task` are auto-populated. */
export interface FeedEvent {
  event: string;
  task?: string;
  [key: string]: unknown;
}

/** Append an event to .fleet/run/feed.ndjson. No-op if not in a fleet session. */
export function emitEvent(_event: FeedEvent): void {
  // Stub — emitter task will implement
}
