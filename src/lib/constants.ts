export const SYNC_BRANCH = 'paw-sync';

/** Unit: seconds. */
export const DEFAULT_POLL_INTERVAL = '5';

/** The first message sent to an agent after Claude Code boots. */
export const BEACON_MESSAGE = 'Begin working on your task.';

/** Max time (ms) to wait for Claude Code TUI to render before giving up. */
export const BEACON_TUI_TIMEOUT_MS = 30_000;

/** Poll interval (ms) when waiting for TUI ready. */
export const BEACON_POLL_INTERVAL_MS = 500;

/** Max beacon resend attempts if TUI still shows welcome screen. */
export const BEACON_VERIFY_ATTEMPTS = 5;

/** Delay (ms) between beacon verification checks. */
export const BEACON_VERIFY_DELAY_MS = 2_000;

/** Max time (ms) to wait for session-ready sentinel before sending beacon. */
export const BEACON_SESSION_READY_TIMEOUT_MS = 60_000;

/** Delays (ms) for follow-up empty Enters after initial beacon send. */
export const BEACON_FOLLOWUP_DELAYS: readonly number[] = [5_000, 10_000];

export const ORCHESTRATOR_ROLE = 'paw-orchestrator';
export const TUI_ROLE = 'paw-tui';

// --- Health monitoring thresholds ---

/** Seconds with no heartbeat before an agent is considered stalled. */
export const STALL_THRESHOLD_S = 300;

/** Seconds with no heartbeat before an agent is considered a zombie. */
export const ZOMBIE_THRESHOLD_S = 600;

/** Seconds between nudge messages to a stalled agent. */
export const NUDGE_INTERVAL_S = 90;

/** Maximum escalation level: 0=warn, 1=nudge, 2=triage, 3=terminate. */
export const MAX_ESCALATION_LEVEL = 3;

/** Minimum seconds between inbox checks (debounce). */
export const INBOX_DEBOUNCE_S = 30;

/** Fixed column width of the TUI left sidebar. */
export const SIDEBAR_WIDTH = 40;

/** Timeout (ms) for triage AI classification. */
export const TRIAGE_TIMEOUT_MS = 30_000;

/** Number of terminal lines to capture for triage. */
export const TRIAGE_CAPTURE_LINES = 100;

/** Timeout (ms) for PR review session (full agent session with tool calls). */
export const REVIEW_TIMEOUT_MS = 600_000;

/** Time (ms) before sending a nudge to a slow reviewer. */
export const REVIEW_NUDGE_MS = 300_000;

/** Max review cycles before proceeding with merge anyway. */
export const REVIEW_MAX_RETRIES = 2;
