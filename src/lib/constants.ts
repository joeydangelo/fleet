export const SYNC_BRANCH = 'paw-sync';

/** Unit: seconds. */
export const DEFAULT_POLL_INTERVAL = '5';

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

// --- Health monitoring thresholds ---

/** Seconds with no heartbeat before an agent is considered stalled. */
export const STALL_THRESHOLD_S = 180;

/** Seconds with no heartbeat before an agent is considered a zombie. */
export const ZOMBIE_THRESHOLD_S = 480;

/** Seconds to wait after launch before expecting a heartbeat. */
export const BOOT_GRACE_S = 60;

/** Seconds between nudge messages to a stalled agent. */
export const NUDGE_INTERVAL_S = 90;

/** Maximum nudge attempts before triaging (matches overstory's 1-nudge-then-triage pattern). */
export const MAX_NUDGES = 1;

/** Minimum seconds between inbox checks (debounce). */
export const INBOX_DEBOUNCE_S = 30;

/** Timeout (ms) for triage AI classification. */
export const TRIAGE_TIMEOUT_MS = 30_000;

/** Number of terminal lines to capture for triage. */
export const TRIAGE_CAPTURE_LINES = 100;
