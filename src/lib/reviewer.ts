/**
 * PR reviewer — launches a read-only Claude session in tmux to review a task
 * branch diff. The reviewer loads `paw shortcut review-pr` and relevant
 * guidelines autonomously, then returns PASS/FAIL with structured findings.
 *
 * Unlike triage (which uses --print one-shot), the reviewer runs as a real
 * Claude Code session so it can invoke tools (paw shortcut, paw guidelines).
 * It is restricted to read-only tools via --allowedTools / --disallowedTools
 * and skips project hooks via --setting-sources "user" so paw prime doesn't
 * fire.
 *
 * Includes mini-ZFC monitoring: warning → nudge → capture → timeout.
 * Since the reviewer skips project hooks (no heartbeats), escalation is
 * time-based rather than heartbeat-based.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import type { TmuxServiceApi } from './tmux.js';
import { waitForTuiReady, killDetachedSession, isTuiPromptReady } from './tmux.js';
import { REVIEW_TIMEOUT_MS, REVIEW_NUDGE_MS } from './constants.js';

/** Prefix for all reviewer tmux sessions. */
const REVIEW_SESSION_PREFIX = 'paw-review-';

export type ReviewVerdict = 'pass' | 'fail';

export interface ReviewResult {
  verdict: ReviewVerdict;
  findings: string;
}

/** Callback for the orchestrator to log reviewer state transitions. */
export interface ReviewCallbacks {
  onWarning?: (elapsed: string) => void;
  onNudge?: (elapsed: string) => void;
  onCapture?: (elapsed: string, capturedPath: string) => void;
  onTimeout?: (elapsed: string) => void;
}

/** How often to poll for the reviewer's verdict. */
const REVIEW_POLL_MS = 3_000;

/** Lines of pane content to capture when checking for verdict. */
const REVIEW_CAPTURE_LINES = 200;

/** Marker the reviewer prints after the verdict so we know it's done. */
const REVIEW_DONE_MARKER = '--- PAW_REVIEW_COMPLETE ---';

/** Time (ms) before logging a warning that the reviewer is still working. */
const REVIEW_WARN_MS = 120_000;

/**
 * Build the claude command for the reviewer session.
 * - No project hooks (--setting-sources "user" skips .claude/settings.json)
 * - Read-only tools only (no Edit, Write, NotebookEdit, Agent)
 * - Permissionless (automated — no human to approve)
 */
function buildReviewerCommand(): string {
  const allowedTools = [
    'Read',
    'Glob',
    'Grep',
    'Bash(paw shortcut*)',
    'Bash(paw guidelines*)',
    'Bash(paw template*)',
    'Bash(git diff*)',
    'Bash(git log*)',
    'Bash(gh pr *)',
  ].join(',');

  const disallowedTools = ['Edit', 'Write', 'NotebookEdit', 'Agent'].join(',');

  return [
    'claude',
    '--dangerously-skip-permissions',
    '--setting-sources',
    '"user"',
    '--allowedTools',
    `"${allowedTools}"`,
    '--disallowedTools',
    `"${disallowedTools}"`,
  ].join(' ');
}

/**
 * Build the review prompt sent via send-keys after the session starts.
 * Tells the reviewer to load `paw shortcut review-pr`, follow its instructions,
 * and print the done marker when finished.
 */
function buildReviewPrompt(
  taskBranch: string,
  targetBranch: string,
  priorFindingsPaths?: string[],
): string {
  const steps = [`You are reviewing task branch "${taskBranch}" against "${targetBranch}".`, ''];

  if (priorFindingsPaths && priorFindingsPaths.length > 0) {
    steps.push(
      'STEP 0: Read the prior review findings files below using the Read tool. ' +
        'Verify whether each finding was addressed in the current diff. ' +
        'Note any unresolved findings in your review output.',
    );
    for (const p of priorFindingsPaths) {
      steps.push(`  - ${p}`);
    }
    steps.push('');
  }

  steps.push(
    'STEP 1: Run `paw shortcut review-pr` and read the review instructions.',
    'STEP 2: Get the diff by running: git diff ' + targetBranch + '...' + taskBranch,
    'STEP 3: Load relevant guidelines as instructed by the review-pr shortcut.',
    'STEP 4: Perform the review and compile findings.',
    'STEP 5: Print your verdict. The FIRST line must be exactly PASS or FAIL.',
    'STEP 6: After your full review output, print this exact line:',
    REVIEW_DONE_MARKER,
  );

  return steps.join(' ');
}

/** Build the nudge message sent when the reviewer is taking too long. */
function buildNudgeMessage(): string {
  return [
    'You have been reviewing for a while.',
    'Please wrap up your review and print your verdict now.',
    'The FIRST line must be exactly PASS or FAIL, followed by your findings.',
    'Then print this exact line: ' + REVIEW_DONE_MARKER,
  ].join(' ');
}

/**
 * Parse the reviewer's output to extract the verdict and findings.
 * Scans captured pane content for the done marker, then looks backward
 * for the PASS/FAIL verdict line.
 */
function parseReviewOutput(captured: string): ReviewResult | null {
  if (!captured.includes(REVIEW_DONE_MARKER)) return null;

  // Everything before the done marker is the review output
  const beforeMarker = captured.split(REVIEW_DONE_MARKER)[0] ?? '';

  // Find the verdict — scan lines for one starting with PASS or FAIL
  const lines = beforeMarker.split('\n');
  let verdictLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim().toUpperCase();
    if (
      trimmed === 'PASS' ||
      trimmed === 'FAIL' ||
      trimmed.startsWith('PASS') ||
      trimmed.startsWith('FAIL')
    ) {
      verdictLine = i;
      break;
    }
  }

  if (verdictLine === -1) {
    // No clear verdict found — treat as fail with the raw output
    return { verdict: 'fail', findings: beforeMarker.trim() };
  }

  const firstLine = lines[verdictLine]!.trim().toUpperCase();
  const verdict: ReviewVerdict = firstLine.startsWith('PASS') ? 'pass' : 'fail';

  // Everything from the verdict line onward is the findings
  const findings = lines.slice(verdictLine).join('\n').trim();
  return { verdict, findings };
}

/** Format elapsed milliseconds as "Xm Ys". */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Save captured pane content to disk for post-mortem debugging. */
function saveCapture(repoRoot: string, taskBranch: string, content: string): string {
  const safeName = taskBranch.replace(/[^a-zA-Z0-9-]/g, '-');
  const dir = resolve(repoRoot, '.paw', 'run', 'review');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${safeName}.txt`);
  writeFileSync(
    path,
    `# Review capture: ${taskBranch}\n# ${new Date().toISOString()}\n\n${content}`,
  );
  return path;
}

/** Kill any orphaned reviewer tmux sessions (paw-review-*). Used by paw down. */
export function killReviewerSessions(tmux: TmuxServiceApi): void {
  let sessions: string[];
  try {
    const raw = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    sessions = raw.trim().split('\n').filter(Boolean);
  } catch {
    return;
  }

  for (const name of sessions) {
    if (name.startsWith(REVIEW_SESSION_PREFIX)) {
      killDetachedSession(tmux, name);
    }
  }
}

/**
 * Review a task branch by launching a Claude session in a detached tmux session.
 * The reviewer loads `paw shortcut review-pr` and guidelines autonomously.
 *
 * Mini-ZFC escalation (time-based, no heartbeats):
 *   0–2min:  polling silently
 *   2min:    warning — reviewer is still working
 *   5min:    nudge — send-keys reminder to wrap up
 *   10min:   timeout — capture pane for diagnostics, default to pass
 *
 * @param tmux - Tmux service for session management
 * @param taskBranch - The task branch to review (e.g., "feature/api-auth")
 * @param targetBranch - The target branch to diff against (e.g., "feature/main")
 * @param repoRoot - Repository root path
 * @param callbacks - Optional callbacks for orchestrator logging
 * @returns ReviewResult with verdict (pass/fail) and findings text
 */
export async function reviewTask(
  tmux: TmuxServiceApi,
  taskBranch: string,
  targetBranch: string,
  repoRoot: string,
  callbacks?: ReviewCallbacks,
  priorFindingsPaths?: string[],
): Promise<ReviewResult> {
  const sessionName = `${REVIEW_SESSION_PREFIX}${taskBranch.replace(/[^a-zA-Z0-9-]/g, '-')}`;

  // Clean up any leftover session from a previous run
  killDetachedSession(tmux, sessionName);

  // Escalation flags — each fires once
  let warned = false;
  let nudged = false;

  try {
    // Launch the reviewer session
    tmux.createSession(sessionName, repoRoot);
    tmux.sendKeys(sessionName, buildReviewerCommand());

    // Wait for Claude TUI to be ready
    const ready = await waitForTuiReady(tmux, sessionName, 30_000, 1_000);
    if (!ready) {
      return { verdict: 'pass', findings: 'Reviewer session failed to start — skipping review.' };
    }

    // Small delay for TUI to fully initialize
    await new Promise((r) => setTimeout(r, 2_000));

    // Send the review prompt
    tmux.sendKeys(sessionName, buildReviewPrompt(taskBranch, targetBranch, priorFindingsPaths));

    const startTime = Date.now();
    const maxPolls = Math.ceil(REVIEW_TIMEOUT_MS / REVIEW_POLL_MS);

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, REVIEW_POLL_MS));

      const elapsed = Date.now() - startTime;

      // Check if session is still alive
      if (!tmux.sessionExists(sessionName)) {
        return {
          verdict: 'pass',
          findings: 'Reviewer session exited unexpectedly — skipping review.',
        };
      }

      // Capture pane content
      const captured = tmux.capturePaneContent(sessionName, REVIEW_CAPTURE_LINES);
      if (!captured) continue;

      // Check for completed review
      const result = parseReviewOutput(captured);
      if (result) return result;

      // Mini-ZFC escalation

      // Warning: reviewer is taking a while (2min)
      if (!warned && elapsed >= REVIEW_WARN_MS) {
        warned = true;
        callbacks?.onWarning?.(formatElapsed(elapsed));
      }

      // Nudge: send reminder to wrap up (5min)
      if (!nudged && elapsed >= REVIEW_NUDGE_MS) {
        nudged = true;
        callbacks?.onNudge?.(formatElapsed(elapsed));

        // Only nudge if the reviewer appears idle at the prompt
        if (isTuiPromptReady(captured)) {
          tmux.sendKeys(sessionName, buildNudgeMessage());
        }
      }
    }

    // Timeout: capture pane for diagnostics, then pass
    const finalCapture = tmux.capturePaneContent(sessionName, REVIEW_CAPTURE_LINES);
    if (finalCapture) {
      // One last attempt to parse — maybe verdict appeared in final capture
      const lastResult = parseReviewOutput(finalCapture);
      if (lastResult) return lastResult;

      const capturePath = saveCapture(repoRoot, taskBranch, finalCapture);
      callbacks?.onCapture?.(
        formatElapsed(Date.now() - (Date.now() - REVIEW_TIMEOUT_MS)),
        capturePath,
      );
      callbacks?.onTimeout?.(formatElapsed(REVIEW_TIMEOUT_MS));
    }

    return { verdict: 'pass', findings: 'Review timed out — skipping review.' };
  } finally {
    // Always clean up the reviewer session
    killDetachedSession(tmux, sessionName);
  }
}
