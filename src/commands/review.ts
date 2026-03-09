import { resolve } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot, getCurrentBranch } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import {
  readSyncState,
  readSyncFile,
  submitForReview,
  completeTask,
  reopenTask,
  writeSyncState,
  writeSyncFile,
} from '../lib/sync.js';
import { createTmuxService } from '../lib/tmux.js';
import { reviewTask } from '../lib/reviewer.js';
import { REVIEW_MAX_RETRIES } from '../lib/constants.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';

/** Build the `paw review` CLI command. */
export function reviewCommand(): Command {
  return new Command('review')
    .description('Submit task for review — blocks until verdict, exits 0 on PASS/SKIP, 1 on FAIL')
    .action(async () => {
      try {
        const exitCode = await runReview();
        if (exitCode !== 0) process.exit(exitCode);
      } catch (err) {
        handleError(err);
      }
    });
}

/** Submit the current task for review — returns 0 on PASS/SKIP, 1 on FAIL. */
export async function runReview(): Promise<number> {
  const repoRoot = getRepoRoot();
  const taskName = detectTaskName(repoRoot);

  if (!taskName) {
    console.error(colors.error('Could not detect task name. Are you in a paw worktree?'));
    console.error(pc.dim('Expected a single .md file in .paw/tasks/.'));
    return 1;
  }

  let state = readSyncState(repoRoot);
  requireSyncState(state);

  const task = state.tasks[taskName];
  if (!task) {
    console.error(colors.error(`Task '${taskName}' not found in sync state.`));
    return 1;
  }

  const nextCycle = (task.reviewCycle ?? 0) + 1;
  if (nextCycle > REVIEW_MAX_RETRIES) {
    state = completeTask(state, taskName);
    writeSyncState(state, repoRoot);
    console.log(colors.warn(`  ${taskName} -- max review cycles reached, marked done`));
    return 0;
  }

  state = submitForReview(state, taskName);
  writeSyncState(state, repoRoot);
  console.log(pc.dim(`  ${taskName} -- submitted for review (cycle ${nextCycle})`));

  let tmux;
  try {
    tmux = createTmuxService();
  } catch {
    // tmux not available — auto-complete
    state = readSyncState(repoRoot)!;
    state = completeTask(state, taskName);
    writeSyncState(state, repoRoot);
    console.log(pc.dim('  tmux not available — review skipped, marked done'));
    return 0;
  }

  const taskBranch = getCurrentBranch(repoRoot);
  const targetBranch = state.target;
  const taskFilePath = resolve(repoRoot, '.paw', 'tasks', `${taskName}.md`);
  const safeBranch = taskBranch.replace(/[^a-zA-Z0-9-]/g, '-');
  const reviewFilePath = `review/${safeBranch}.md`;

  console.log(pc.dim(`  Reviewing ${taskName}...`));
  const result = await reviewTask(
    tmux,
    taskBranch,
    targetBranch,
    repoRoot,
    {
      onWarning: (elapsed) => console.log(pc.yellow(`  ⚠ reviewer still working (${elapsed})`)),
      onNudge: (elapsed) => console.log(pc.yellow(`  📩 nudging reviewer to wrap up (${elapsed})`)),
      onCapture: (_elapsed, path) => console.log(pc.dim(`  📋 reviewer capture saved: ${path}`)),
      onTimeout: (elapsed) => console.log(pc.red(`  ⏱ reviewer timed out (${elapsed}) — skipping`)),
    },
    taskFilePath,
    reviewFilePath,
  );

  // Build the "## Review — Cycle N" section from the verdict
  const findingsSection = [
    ``,
    `---`,
    ``,
    `## Review — Cycle ${nextCycle}`,
    `**Verdict:** ${result.verdict.toUpperCase()}`,
    ``,
    `### Strengths`,
    result.strengths || '(none)',
    ``,
    `### Issues`,
    result.issues || '(none)',
  ];
  if (result.suggestions) {
    findingsSection.push(``, `### Suggestions`, result.suggestions);
  }
  const findingsText = findingsSection.join('\n') + '\n';

  // Append findings directly to sync branch (no local file)
  try {
    const existing = readSyncFile(reviewFilePath, repoRoot) ?? '';
    writeSyncFile(reviewFilePath, existing + findingsText, repoRoot);
  } catch (err: unknown) {
    console.log(pc.dim(`  warning: failed to persist findings: ${String(err)}`));
  }

  // Sync state may have changed during the async review
  state = readSyncState(repoRoot)!;

  if (result.verdict === 'pass' || result.verdict === 'skip') {
    state = completeTask(state, taskName);
    writeSyncState(state, repoRoot);
    if (result.verdict === 'skip') {
      console.log(colors.warn(`  ${taskName} -- SKIP (review timed out)`));
    } else {
      console.log(colors.success(`  ${taskName} -- PASS`));
    }
    return 0;
  }

  state = reopenTask(state, taskName);
  writeSyncState(state, repoRoot);

  const issueCount = result.issues
    ? result.issues.split('\n').filter((l) => /^(CRITICAL|MAJOR|MINOR)\//i.test(l.trim())).length
    : 0;
  console.log(
    colors.warn(`  ${taskName} -- FAIL (${issueCount} issue${issueCount !== 1 ? 's' : ''})`),
  );
  console.log();

  if (result.strengths) {
    console.log(pc.bold('Strengths:'));
    console.log(result.strengths);
    console.log();
  }
  console.log(pc.bold('Issues:'));
  console.log(result.issues);
  if (result.suggestions) {
    console.log();
    console.log(pc.bold('Suggestions:'));
    console.log(result.suggestions);
  }

  return 1;
}
