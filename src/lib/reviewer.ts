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
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import type { TmuxServiceApi } from './tmux.js';
import { waitForTuiReady, killDetachedSession, isTuiPromptReady } from './tmux.js';
import { REVIEW_TIMEOUT_MS, REVIEW_NUDGE_MS, BEACON_FOLLOWUP_DELAYS } from './constants.js';

/** Prefix for all reviewer tmux sessions. */
const REVIEW_SESSION_PREFIX = 'paw-review-';

export type ReviewVerdict = 'pass' | 'fail' | 'skip';

export interface ReviewResult {
  verdict: ReviewVerdict;
  strengths: string;
  issues: string;
  suggestions?: string;
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

/** Time (ms) before logging a warning that the reviewer is still working. */
const REVIEW_WARN_MS = 120_000;

/** Compute the path for the out-of-band verdict sentinel file. */
export function verdictFilePath(repoRoot: string, taskBranch: string): string {
  const safeName = taskBranch.replace(/[^a-zA-Z0-9-]/g, '-');
  return resolve(repoRoot, '.paw', 'run', `review-verdict-${safeName}.json`);
}

/** Read and parse the verdict sentinel file. Returns null if not yet written. */
export function readVerdictFile(filePath: string): ReviewResult | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      verdict?: string;
      strengths?: string;
      issues?: string;
      suggestions?: string;
    };
    const v = String(data.verdict ?? '').toLowerCase();
    const verdict: ReviewVerdict = v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : 'fail';
    return {
      verdict,
      strengths: String(data.strengths ?? ''),
      issues: String(data.issues ?? ''),
      suggestions: data.suggestions ? String(data.suggestions) : undefined,
    };
  } catch {
    return null;
  }
}

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
    'Bash(node -e *)',
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
 * and write a verdict JSON file when finished (out-of-band signaling).
 */
function buildReviewPrompt(
  taskBranch: string,
  targetBranch: string,
  verdictPath: string,
  taskFilePath?: string,
): string {
  const steps = [`You are reviewing task branch "${taskBranch}" against "${targetBranch}".`, ''];

  if (taskFilePath) {
    steps.push(
      'TASK CONTEXT: Read the task assignment file to understand what this branch is supposed to do:',
      `  - ${taskFilePath}`,
      '',
    );
  }

  // Escape the path for embedding in a JSON string inside a node -e command
  const escapedPath = verdictPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  steps.push(
    'STEP 1: Run `paw shortcut review-pr` and read the review instructions.',
    'STEP 2: Read the PR by running: gh pr view ' + taskBranch + ' --json title,body,labels',
    'STEP 3: Check CI by running: gh pr checks ' +
      taskBranch +
      ' — if checks are failing, skip the review and write a FAIL verdict immediately with the failing check as a CRITICAL/testing issue.',
    'STEP 4: Get the diff by running: git diff ' + targetBranch + '...' + taskBranch,
    'STEP 5: Load relevant guidelines as instructed by the review-pr shortcut.',
    'STEP 6: Perform the review and compile findings.',
    'STEP 7: Determine your verdict (PASS or FAIL).',
    'STEP 8: Write the verdict file by running a Bash command like this:',
    `node -e "require('fs').writeFileSync('${escapedPath}', JSON.stringify({ verdict: 'PASS_OR_FAIL', strengths: 'what was done well', issues: 'CRITICAL/MAJOR/MINOR findings', suggestions: 'optional non-blocking observations' }))"`,
    'Replace the placeholder values with your actual review content. The JSON keys are: verdict (PASS or FAIL), strengths (brief), issues (all findings in severity/category file:line format), suggestions (optional, omit if none).',
    'This file write is MANDATORY — it signals completion to the orchestrator.',
  );

  return steps.join(' ');
}

/** Build the nudge message sent when the reviewer is taking too long. */
function buildNudgeMessage(verdictPath: string): string {
  const escapedPath = verdictPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return [
    'You have been reviewing for a while.',
    'Please wrap up your review and write the verdict file now.',
    'Run this Bash command with your verdict and review content:',
    `node -e "require('fs').writeFileSync('${escapedPath}', JSON.stringify({ verdict: 'PASS_OR_FAIL', strengths: '...', issues: '...', suggestions: '...' }))"`,
  ].join(' ');
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
    // tmux not running — no sessions to clean up
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
 *   10min:   timeout — capture pane for diagnostics, default to skip
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
  taskFilePath?: string,
): Promise<ReviewResult> {
  const sessionName = `${REVIEW_SESSION_PREFIX}${taskBranch.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  const vPath = verdictFilePath(repoRoot, taskBranch);

  // Clean up any leftover session or verdict file from a previous run
  killDetachedSession(tmux, sessionName);
  try {
    rmSync(vPath);
  } catch {
    /* already gone */
  }

  // Ensure the parent directory exists for the verdict file
  mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });

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
      return {
        verdict: 'skip',
        strengths: '',
        issues: 'Reviewer session failed to start — skipping review.',
      };
    }

    // Small delay for TUI to fully initialize
    await new Promise((r) => setTimeout(r, 2_000));

    // Send the review prompt
    tmux.sendKeys(sessionName, buildReviewPrompt(taskBranch, targetBranch, vPath, taskFilePath));

    // Follow-up empty Enters to dismiss trust/permission dialogs (same as sendBeacon)
    for (const delay of BEACON_FOLLOWUP_DELAYS) {
      await new Promise((r) => setTimeout(r, delay));
      tmux.sendKeys(sessionName, '');
    }

    const startTime = Date.now();
    const maxPolls = Math.ceil(REVIEW_TIMEOUT_MS / REVIEW_POLL_MS);

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, REVIEW_POLL_MS));

      const elapsed = Date.now() - startTime;

      // Check if session is still alive
      if (!tmux.sessionExists(sessionName)) {
        // Session died — check if it wrote a verdict before exiting
        const fileResult = readVerdictFile(vPath);
        if (fileResult) return fileResult;
        return {
          verdict: 'skip',
          strengths: '',
          issues: 'Reviewer session exited unexpectedly — skipping review.',
        };
      }

      // Primary: check for verdict file (out-of-band sentinel)
      const fileResult = readVerdictFile(vPath);
      if (fileResult) return fileResult;

      // Mini-ZFC escalation (uses pane capture for idle detection only)

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
        const captured = tmux.capturePaneContent(sessionName, REVIEW_CAPTURE_LINES);
        if (captured && isTuiPromptReady(captured)) {
          tmux.sendKeys(sessionName, buildNudgeMessage(vPath));
          // Follow-up Enter to dismiss any dialog
          await new Promise((r) => setTimeout(r, BEACON_FOLLOWUP_DELAYS[0]));
          tmux.sendKeys(sessionName, '');
        }
      }
    }

    // Timeout: one last check for verdict file, then capture pane for diagnostics
    const finalFileResult = readVerdictFile(vPath);
    if (finalFileResult) return finalFileResult;

    const finalCapture = tmux.capturePaneContent(sessionName, REVIEW_CAPTURE_LINES);
    if (finalCapture) {
      const capturePath = saveCapture(repoRoot, taskBranch, finalCapture);
      callbacks?.onCapture?.(formatElapsed(Date.now() - startTime), capturePath);
      callbacks?.onTimeout?.(formatElapsed(REVIEW_TIMEOUT_MS));
    }

    return { verdict: 'skip', strengths: '', issues: 'Review timed out — skipping review.' };
  } finally {
    // Always clean up the reviewer session and verdict file
    killDetachedSession(tmux, sessionName);
    try {
      rmSync(vPath);
    } catch {
      /* already gone */
    }
  }
}
