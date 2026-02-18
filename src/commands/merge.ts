import { Command } from 'commander';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import {
  getRepoRoot,
  getCurrentBranch,
  mergeBranch,
  getCommitCount,
  isMergeInProgress,
  isAncestor,
  commitUntrackedFiles,
  getHeadRef,
  createBackupRef,
} from '../lib/git.js';
import { loadConfig, resolveConfigPath, topologicalSort } from '../lib/config.js';
import type { PawConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import type { WorktreeInfo } from '../lib/session.js';
import {
  readSyncState,
  writeSyncState,
  writeSyncStateAndFiles,
  initMergeState,
  updateMergeEntry,
} from '../lib/sync.js';
import type { SyncState } from '../lib/sync.js';
import { generateConflictBrief } from '../lib/conflict.js';
import { success, warn, skip, handleError } from '../lib/output.js';

export function mergeCommand(): Command {
  return new Command('merge')
    .description('Merge done task branches into the target branch')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--pick <task>', 'Merge only a specific task')
    .option('--continue', 'Continue merging after resolving a conflict')
    .action((opts: { config?: string; pick?: string; continue?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);

        const currentBranch = getCurrentBranch(repoRoot);
        if (currentBranch !== config.target) {
          console.error(
            pc.red(
              `Must be on target branch '${config.target}' to merge. Currently on '${currentBranch}'.`,
            ),
          );
          process.exit(1);
        }

        let state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red('No sync state found. Run `paw up` first.'));
          process.exit(1);
        }

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

        // Initialize merge state if not present
        if (!state.merges) {
          state = {
            ...state,
            merges: initMergeState(worktrees.map((wt) => wt.taskName)),
          };
          writeSyncState(state, repoRoot);
        }

        const toMerge = opts.pick ? worktrees.filter((wt) => wt.taskName === opts.pick) : worktrees;

        if (toMerge.length === 0) {
          console.error(pc.red(`Task '${opts.pick}' not found in config.`));
          process.exit(1);
        }

        console.log(pc.bold('paw merge\n'));
        runMergeLoop(state, toMerge, config, repoRoot);
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
    console.error(pc.red('Git merge is still in progress. Resolve conflicts and commit first.'));
    process.exit(1);
  }

  if (!state.merges) {
    console.error(pc.red('No merge state found. Run `paw merge` first.'));
    process.exit(1);
  }

  // Handle hook_failed: the merge commit already exists, user fixed the issue
  const hookFailedTask = worktrees.find(
    (wt) => state.merges?.[wt.taskName]?.status === 'hook_failed',
  );

  if (hookFailedTask) {
    // Verify the branch's commits are actually in HEAD (paw-0yqg)
    if (!isAncestor(hookFailedTask.branch, 'HEAD', repoRoot)) {
      console.error(
        pc.red(
          `Branch '${hookFailedTask.branch}' was not merged into the target. ` +
            `Its commits are not in HEAD. Re-run \`paw merge\` to retry.`,
        ),
      );
      process.exit(1);
    }

    const updated = updateMergeEntry(state, hookFailedTask.taskName, {
      status: 'merged',
      merged: new Date().toISOString(),
    });
    writeSyncState(updated, repoRoot);

    console.log(pc.bold('paw merge --continue\n'));
    success(hookFailedTask.taskName, 'hook failure resolved');

    return updated;
  }

  const conflictTask = worktrees.find((wt) => state.merges?.[wt.taskName]?.status === 'conflict');

  if (!conflictTask) {
    console.error(pc.red('No conflicting or failed merge found. Run `paw merge` first.'));
    process.exit(1);
  }

  // Verify the branch's commits are actually in HEAD (paw-0yqg)
  if (!isAncestor(conflictTask.branch, 'HEAD', repoRoot)) {
    console.error(
      pc.red(
        `Branch '${conflictTask.branch}' was not merged into the target. ` +
          `Its commits are not in HEAD. Re-run \`paw merge\` to retry.`,
      ),
    );
    process.exit(1);
  }

  const updated = updateMergeEntry(state, conflictTask.taskName, {
    status: 'merged',
    merged: new Date().toISOString(),
  });
  writeSyncState(updated, repoRoot);

  console.log(pc.bold('paw merge --continue\n'));
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
  config: PawConfig,
  repoRoot: string,
): void {
  let state = initialState;
  const target = config.target;
  const postMergeHook = config.hooks?.['post-merge'];

  for (const wt of worktrees) {
    const mergeEntry = state.merges?.[wt.taskName];

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
      console.log(pc.yellow('\nResolve the conflict, commit, then run: paw merge --continue'));
      process.exit(1);
    }
    if (mergeEntry?.status === 'hook_failed') {
      warn(wt.taskName, 'post-merge hook failed');
      console.log(pc.yellow('\nFix the issue, then run: paw merge --continue'));
      console.log(
        pc.yellow(`To roll back:        git reset --hard refs/paw-backup/${wt.taskName}`),
      );
      process.exit(1);
    }

    const commits = getCommitCount(wt.branch, target, repoRoot);
    if (commits === 0) {
      state = updateMergeEntry(state, wt.taskName, { status: 'skipped' });
      writeSyncState(state, repoRoot);
      skip(wt.taskName, 'no commits');
      continue;
    }

    // Stage untracked files to prevent "untracked working tree files would be
    // overwritten" errors during merge (paw-gbu0).
    commitUntrackedFiles(repoRoot, wt.taskName);

    // Save backup ref before merge
    const headBefore = getHeadRef(repoRoot);
    createBackupRef(wt.taskName, headBefore, repoRoot);

    const result = mergeBranch(wt.branch, repoRoot);
    if (result.success) {
      success(wt.taskName, 'merged clean');

      // Run post-merge hook if configured
      if (postMergeHook) {
        console.log(pc.dim(`    Running post-merge hook: ${postMergeHook}`));
        const hookOk = runPostMergeHook(postMergeHook, repoRoot);
        if (!hookOk) {
          state = updateMergeEntry(state, wt.taskName, {
            status: 'hook_failed',
          });
          writeSyncState(state, repoRoot);

          warn(wt.taskName, 'post-merge hook failed');
          console.log(pc.yellow('\n  The merge committed but validation failed.'));
          console.log(pc.yellow('  To continue anyway:  paw merge --continue'));
          console.log(
            pc.yellow(`  To roll back:        git reset --hard refs/paw-backup/${wt.taskName}`),
          );
          process.exit(1);
        }
      }

      state = updateMergeEntry(state, wt.taskName, {
        status: 'merged',
        merged: new Date().toISOString(),
      });
      writeSyncState(state, repoRoot);
    } else {
      // Generate conflict brief
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
      console.log(pc.dim(`    ${result.message.split('\n')[0]}`));
      console.log(pc.dim(`    Brief written to ${briefPath} on sync branch`));
      console.log(pc.yellow('\nResolve the conflict, commit, then run: paw merge --continue'));
      process.exit(1);
    }
  }
}

/** Run a post-merge hook command. Returns true if successful, false on failure. */
function runPostMergeHook(command: string, cwd: string): boolean {
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}
