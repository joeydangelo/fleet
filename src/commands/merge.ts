import { Command } from 'commander';
import pc from 'picocolors';
import {
  getCurrentBranch,
  mergeBranch,
  getCommitCount,
  isMergeInProgress,
  isAncestor,
  stashWorkingTree,
  unstashWorkingTree,
  getHeadRef,
  createBackupRef,
} from '../lib/git.js';
import { loadRepoConfig, topologicalSort } from '../lib/config.js';
import type { FleetConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import type { WorktreeInfo } from '../lib/session.js';
import {
  readRequiredSyncState,
  writeSyncState,
  writeSyncStateAndFiles,
  initMergeState,
  updateMergeEntry,
} from '../lib/sync.js';
import type { SyncState } from '../lib/sync.js';
import { generateConflictBrief } from '../lib/conflict.js';
import { success, warn, skip, handleError } from '../lib/output.js';
import { ValidationError } from '../lib/errors.js';

/** Build the `fleet merge` CLI command. */
export function mergeCommand(): Command {
  return new Command('merge')
    .description('Merge done task branches into the target branch')
    .option('--continue', 'Continue merging after resolving a conflict')
    .action((opts: { continue?: boolean }) => {
      try {
        const { repoRoot, config } = loadRepoConfig();

        const currentBranch = getCurrentBranch(repoRoot);
        if (currentBranch !== config.target) {
          throw new ValidationError(
            `Must be on target branch '${config.target}' to merge. Currently on '${currentBranch}'.`,
          );
        }

        let state = readRequiredSyncState(repoRoot);

        const allWorktrees = planWorktrees(config, repoRoot);
        const sortedNames = topologicalSort(config.tasks);
        const worktrees = sortedNames.map(
          (name) => allWorktrees.find((wt) => wt.taskName === name)!,
        );

        if (opts.continue) {
          state = handleMergeContinue(state, worktrees, repoRoot);
          runMergeLoop(state, worktrees, config, repoRoot);
          return;
        }

        if (Object.keys(state.merges).length === 0) {
          state = {
            ...state,
            merges: initMergeState(worktrees.map((wt) => wt.taskName)),
          };
          writeSyncState(state, repoRoot);
        }

        console.log(pc.bold('fleet merge\n'));
        runMergeLoop(state, worktrees, config, repoRoot);
      } catch (err) {
        handleError(err);
      }
    });
}

/**
 * Handle --continue: verify conflict is resolved, mark it merged, and
 * return updated state so the caller can resume the merge loop.
 */
function handleMergeContinue(
  state: SyncState,
  worktrees: WorktreeInfo[],
  repoRoot: string,
): SyncState {
  if (isMergeInProgress(repoRoot)) {
    throw new ValidationError(
      'Git merge is still in progress. Resolve conflicts and commit first.',
    );
  }

  const conflictTask = worktrees.find((wt) => state.merges[wt.taskName]?.status === 'conflict');

  if (!conflictTask) {
    throw new ValidationError('No conflicting or failed merge found. Run `fleet merge` first.');
  }

  if (!isAncestor(conflictTask.branch, 'HEAD', repoRoot)) {
    throw new ValidationError(
      `Branch '${conflictTask.branch}' was not merged into the target. ` +
        `Its commits are not in HEAD. Re-run \`fleet merge\` to retry.`,
    );
  }

  const updated = updateMergeEntry(state, conflictTask.taskName, {
    status: 'merged',
    merged: new Date().toISOString(),
  });
  writeSyncState(updated, repoRoot);

  console.log(pc.bold('fleet merge --continue\n'));
  success(conflictTask.taskName, 'conflict resolved');

  return updated;
}

/**
 * Iterate tasks, merge each one, stop on first conflict or hook failure.
 * Updates sync state after each merge result.
 */
function runMergeLoop(
  initialState: SyncState,
  worktrees: WorktreeInfo[],
  config: FleetConfig,
  repoRoot: string,
): void {
  let state = initialState;
  const target = config.target;

  const stashed = stashWorkingTree(repoRoot);

  try {
    for (const wt of worktrees) {
      const mergeEntry = state.merges[wt.taskName];

      if (mergeEntry?.status === 'merged') {
        skip(wt.taskName, 'already merged');
        continue;
      }
      if (mergeEntry?.status === 'skipped') {
        skip(wt.taskName, 'no commits');
        continue;
      }
      if (mergeEntry?.status === 'conflict') {
        warn(wt.taskName, 'unresolved conflict');
        console.log(pc.dim(`\nNext: run \`fleet shortcut resolve-merge-conflict\``));
        return;
      }
      const commits = getCommitCount(wt.branch, target, repoRoot);
      if (commits === 0) {
        state = updateMergeEntry(state, wt.taskName, { status: 'skipped' });
        writeSyncState(state, repoRoot);
        skip(wt.taskName, 'no commits');
        continue;
      }

      const headBefore = getHeadRef(repoRoot);
      createBackupRef(wt.taskName, headBefore, repoRoot);

      const result = mergeBranch(wt.branch, repoRoot);
      if (result.success) {
        success(wt.taskName, 'merged clean');

        state = updateMergeEntry(state, wt.taskName, {
          status: 'merged',
          merged: new Date().toISOString(),
        });
        writeSyncState(state, repoRoot);
      } else {
        const briefPath = `conflicts/${wt.taskName}-into-target.md`;
        const brief = generateConflictBrief({
          conflictingTask: wt.taskName,
          target,
          state,
          cwd: repoRoot,
        });

        state = updateMergeEntry(state, wt.taskName, {
          status: 'conflict',
          brief: briefPath,
        });
        writeSyncStateAndFiles(state, [{ path: briefPath, content: brief }], repoRoot);

        warn(wt.taskName, 'conflicts');
        const firstLine =
          result.message.split('\n')[0]?.trim() || result.message || 'Merge completed';
        console.log(pc.dim(`    ${firstLine}`));
        console.log(pc.dim(`    Brief written to ${briefPath} on sync branch`));
        console.log(pc.dim(`\nNext: run \`fleet shortcut resolve-merge-conflict\``));
        return;
      }
    }
  } finally {
    if (stashed && !unstashWorkingTree(repoRoot)) {
      console.log(
        pc.yellow(
          '    Your local changes are saved in git stash. Run `git stash pop` to restore them.',
        ),
      );
    }
  }
}
