export const SYNC_BRANCH = 'paw-sync';

/** Unit: seconds. */
export const DEFAULT_POLL_INTERVAL = '5';

/** Unit: seconds. Default stall detection threshold for watch. */
export const DEFAULT_STALL_THRESHOLD = '300';

/** Max relaunch attempts per task before giving up. */
export const MAX_RELAUNCH_ATTEMPTS = 3;

/** The first message sent to an agent after Claude Code boots. */
export const BEACON_MESSAGE = 'Begin working on your task.';

/** Max time (ms) to wait for Claude Code TUI to render before giving up. */
export const BEACON_TUI_TIMEOUT_MS = 15_000;

/** Poll interval (ms) when waiting for TUI ready. */
export const BEACON_POLL_INTERVAL_MS = 500;

/** Max beacon resend attempts if TUI still shows welcome screen. */
export const BEACON_VERIFY_ATTEMPTS = 5;

/** Delay (ms) between beacon verification checks. */
export const BEACON_VERIFY_DELAY_MS = 2_000;

export const ORCHESTRATOR_ROLE = 'paw-orchestrator';
export const TUI_ROLE = 'paw-tui';
