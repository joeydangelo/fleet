/**
 * PR reviewer — launches a read-only Claude session in tmux to review a task
 * branch diff. The reviewer loads `fleet shortcut review-pr` and relevant
 * guidelines autonomously, then returns PASS/FAIL with structured findings.
 *
 * Unlike triage (which uses --print one-shot), the reviewer runs as a real
 * Claude Code session so it can invoke tools (fleet shortcut, fleet guidelines).
 * It is restricted to read-only tools via --allowedTools / --disallowedTools.
 *
 * Includes mini-ZFC monitoring: warning → nudge → capture → timeout.
 * Since the reviewer skips project hooks (no heartbeats), escalation is
 * time-based rather than heartbeat-based.
 */

import { resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import type { TmuxServiceApi } from './tmux.js';
import {
  waitForAgentReady,
  killDetachedSession,
  isAgentPromptReady,
  sendAndVerifyMessage,
} from './tmux.js';
import { REVIEW_TIMEOUT_MS, REVIEW_NUDGE_MS, BEACON_FOLLOWUP_DELAYS } from './constants.js';
import { sleep, formatElapsed, sanitizeBranchName } from './util.js';
import { reviewFilePath } from './sync.js';
import { emitEvent } from './feed.js';

/** Count review findings (lines starting with CRITICAL/MAJOR/MINOR). */
export function countFindings(issues: string): number {
  return issues.split('\n').filter((l) => /^(CRITICAL|MAJOR|MINOR)/i.test(l.trim())).length;
}

/** Emit a review.verdict feed event if feedContext is provided. */
function emitVerdictEvent(
  feedContext: { taskName: string; cycle: number } | undefined,
  result: ReviewResult,
): void {
  if (!feedContext) return;
  emitEvent({
    event: 'review.verdict',
    task: `${feedContext.taskName}:reviewer`,
    verdict: result.verdict,
    findings: countFindings(result.issues),
  });
}

/** Prefix for all reviewer tmux sessions. */
const REVIEW_SESSION_PREFIX = 'fleet-review-';

/** Outcome of a PR review: pass, fail, or skip (timeout/error). */
export type ReviewVerdict = 'pass' | 'fail' | 'skip';

/** Structured review output: verdict plus categorized findings. */
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
  const safeName = sanitizeBranchName(taskBranch);
  return resolve(repoRoot, '.fleet', 'run', `review-verdict-${safeName}.json`);
}

/** Read and parse the verdict sentinel file. Returns null if not yet written. */
export function readVerdictFile(filePath: string): ReviewResult | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Partial<ReviewResult>;
    const v = String(data.verdict ?? '').toLowerCase();
    // Fail-closed: anything other than an explicit 'pass' is treated as 'fail'
    const verdict: ReviewVerdict = v === 'pass' ? 'pass' : 'fail';
    return {
      verdict,
      strengths: String(data.strengths ?? ''),
      issues: String(data.issues ?? ''),
      suggestions: data.suggestions ? String(data.suggestions) : undefined,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt file — warn and fail-closed so poll loop doesn't wait until timeout
    console.warn(
      `[fleet] Corrupt verdict file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      verdict: 'fail',
      strengths: '',
      issues: `Verdict file corrupt: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build the claude command for the reviewer session.
 * - FLEET_ROLE=reviewer signals hooks to inject reviewer skill and skip fleet prime
 * - Read-only tools only (no Edit, Write, NotebookEdit, Agent)
 * - Permissionless (automated — no human to approve)
 */
function buildReviewerCommand(): string {
  const allowedTools = [
    'Read',
    'Glob',
    'Grep',
    'Bash(fleet shortcut*)',
    'Bash(fleet guidelines*)',
    'Bash(fleet template*)',
    'Bash(git diff*)',
    'Bash(git log*)',
    'Bash(git show fleet-sync:*)',
    'Bash(node -e *)',
    'Agent',
  ].join(',');

  const disallowedTools = ['Edit', 'Write', 'NotebookEdit'].join(',');

  return [
    'FLEET_ROLE=reviewer',
    'claude',
    '--dangerously-skip-permissions',
    '--allowedTools',
    `"${allowedTools}"`,
    '--disallowedTools',
    `"${disallowedTools}"`,
  ].join(' ');
}

/**
 * Build the review prompt sent via send-keys after the session starts.
 * Three concerns only: context, workflow pointer, verdict signaling.
 * The actual review process is defined in `fleet shortcut review-pr`.
 */
function buildReviewPrompt(
  taskBranch: string,
  targetBranch: string,
  verdictPath: string,
  taskFilePath?: string,
  reviewFileOverride?: string,
): string {
  const escapedPath = verdictPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const reviewFile = reviewFileOverride ?? reviewFilePath(taskBranch);

  const lines = [`You are reviewing task branch "${taskBranch}" against "${targetBranch}".`, ''];

  if (taskFilePath) {
    lines.push(`TASK FILE: ${taskFilePath}`);
  }
  lines.push(`REVIEW FILE: git show fleet-sync:${reviewFile}`);
  lines.push(`DIFF: git diff ${targetBranch}...${taskBranch}`);
  lines.push('');
  lines.push('Run `fleet shortcut review-pr` and follow its instructions.');
  lines.push('');
  lines.push('WHEN DONE: Write the verdict file — this is MANDATORY and must be your last action:');
  lines.push(
    `node -e "require('fs').writeFileSync('${escapedPath}', JSON.stringify({ verdict: 'PASS_OR_FAIL', strengths: 'what was done well', issues: 'CRITICAL/MAJOR/MINOR findings', suggestions: 'optional non-blocking observations' }))"`,
  );
  lines.push(
    'Replace placeholders with your actual review. Keys: verdict (PASS or FAIL), strengths (brief), issues (all findings), suggestions (optional).',
  );

  return lines.join(' ');
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

/** Save captured pane content to disk for post-mortem debugging. */
function saveCapture(repoRoot: string, taskBranch: string, content: string): string {
  const safeName = sanitizeBranchName(taskBranch);
  const dir = resolve(repoRoot, '.fleet', 'run', 'review');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${safeName}.txt`);
  writeFileSync(
    path,
    `# Review capture: ${taskBranch}\n# ${new Date().toISOString()}\n\n${content}`,
  );
  return path;
}

/** Kill any orphaned reviewer tmux sessions (fleet-review-*). Used by fleet down. */
export function killReviewerSessions(tmux: TmuxServiceApi): void {
  const sessions = tmux.listSessions();

  for (const name of sessions) {
    if (name.startsWith(REVIEW_SESSION_PREFIX)) {
      killDetachedSession(tmux, name);
    }
  }
}

/**
 * Review a task branch by launching a Claude session in a detached tmux session.
 * The reviewer loads `fleet shortcut review-pr` and guidelines autonomously.
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
  reviewFileOverride?: string,
  feedContext?: { taskName: string; cycle: number },
): Promise<ReviewResult> {
  const sessionName = `${REVIEW_SESSION_PREFIX}${sanitizeBranchName(taskBranch)}`;
  const vPath = verdictFilePath(repoRoot, taskBranch);

  // Clean up any leftover session or verdict file from a previous run
  killDetachedSession(tmux, sessionName);
  try {
    rmSync(vPath);
  } catch {
    /* already gone */
  }

  // Ensure the parent directory exists for the verdict file
  mkdirSync(resolve(repoRoot, '.fleet', 'run'), { recursive: true });

  // Escalation flags — each fires once
  let warned = false;
  let nudged = false;

  try {
    // Launch the reviewer session
    if (feedContext) {
      emitEvent({
        event: 'review.start',
        task: `${feedContext.taskName}:reviewer`,
        cycle: feedContext.cycle,
      });
    }
    tmux.createSession(sessionName, repoRoot);
    tmux.sendKeys(sessionName, buildReviewerCommand());

    const ready = await waitForAgentReady(tmux, sessionName, 30_000, 1_000);
    if (!ready) {
      return {
        verdict: 'skip',
        strengths: '',
        issues: 'Reviewer session failed to start — skipping review.',
      };
    }

    await sleep(2_000);

    // Send the review prompt with verify-and-resend (shared with sendBeacon)
    const reviewPrompt = buildReviewPrompt(
      taskBranch,
      targetBranch,
      vPath,
      taskFilePath,
      reviewFileOverride,
    );
    await sendAndVerifyMessage(tmux, sessionName, reviewPrompt);

    // Read the verdict file and emit a feed event if present.
    // Used at multiple exit points: session death, each poll, and timeout.
    const checkVerdict = (): ReviewResult | null => {
      const result = readVerdictFile(vPath);
      if (result) emitVerdictEvent(feedContext, result);
      return result;
    };

    const startTime = Date.now();
    const maxPolls = Math.ceil(REVIEW_TIMEOUT_MS / REVIEW_POLL_MS);

    for (let i = 0; i < maxPolls; i++) {
      await sleep(REVIEW_POLL_MS);

      const elapsed = Date.now() - startTime;

      // Check if session is still alive
      if (!tmux.sessionExists(sessionName)) {
        return (
          checkVerdict() ?? {
            verdict: 'skip',
            strengths: '',
            issues: 'Reviewer session exited unexpectedly — skipping review.',
          }
        );
      }

      // Primary: check for verdict file (out-of-band sentinel)
      const fileResult = checkVerdict();
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
        if (captured && isAgentPromptReady(captured)) {
          tmux.sendKeys(sessionName, buildNudgeMessage(vPath));
          // Follow-up Enter to dismiss any dialog
          await sleep(BEACON_FOLLOWUP_DELAYS[0]!);
          tmux.sendKeys(sessionName, '');
        }
      }
    }

    // Timeout: one last check for verdict file, then capture pane for diagnostics
    const finalResult = checkVerdict();
    if (finalResult) return finalResult;

    const finalCapture = tmux.capturePaneContent(sessionName, REVIEW_CAPTURE_LINES);
    if (finalCapture) {
      const capturePath = saveCapture(repoRoot, taskBranch, finalCapture);
      callbacks?.onCapture?.(formatElapsed(Date.now() - startTime), capturePath);
      callbacks?.onTimeout?.(formatElapsed(REVIEW_TIMEOUT_MS));
    }

    if (feedContext) {
      emitEvent({
        event: 'review.timeout',
        task: `${feedContext.taskName}:reviewer`,
        elapsed: Math.round(REVIEW_TIMEOUT_MS / 1000),
      });
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
