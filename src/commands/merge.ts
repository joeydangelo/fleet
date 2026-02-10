import { Command } from "commander";
import pc from "picocolors";
import {
  getRepoRoot,
  getCurrentBranch,
  mergeBranch,
  getCommitCount,
  isMergeInProgress,
} from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { planWorktrees } from "../lib/session.js";
import type { WorktreeInfo } from "../lib/session.js";
import {
  readSyncState,
  writeSyncState,
  initMergeState,
  updateMergeEntry,
} from "../lib/sync.js";
import type { SyncState } from "../lib/sync.js";
import { success, warn, skip, handleError } from "../lib/output.js";

export function mergeCommand(): Command {
  return new Command("merge")
    .description("Merge completed task branches into the target branch")
    .option("-c, --config <path>", "Path to paw.yaml")
    .option("--pick <task>", "Merge only a specific task")
    .option("--continue", "Continue merging after resolving a conflict")
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
          console.error(pc.red("No sync state found. Run `paw up` first."));
          process.exit(1);
        }

        const worktrees = planWorktrees(config, repoRoot);

        if (opts.continue) {
          state = handleMergeContinue(state, worktrees, repoRoot);
          runMergeLoop(state, worktrees, config.target, repoRoot);
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

        const toMerge = opts.pick
          ? worktrees.filter((wt) => wt.taskName === opts.pick)
          : worktrees;

        if (toMerge.length === 0) {
          console.error(pc.red(`Task '${opts.pick}' not found in config.`));
          process.exit(1);
        }

        console.log(pc.bold("paw merge\n"));
        runMergeLoop(state, toMerge, config.target, repoRoot);
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
    console.error(
      pc.red(
        "Git merge is still in progress. Resolve conflicts and commit first.",
      ),
    );
    process.exit(1);
  }

  if (!state.merges) {
    console.error(pc.red("No merge state found. Run `paw merge` first."));
    process.exit(1);
  }

  const conflictTask = worktrees.find(
    (wt) => state.merges?.[wt.taskName]?.status === "conflict",
  );

  if (!conflictTask) {
    console.error(pc.red("No conflicting merge found. Run `paw merge` first."));
    process.exit(1);
  }

  const updated = updateMergeEntry(state, conflictTask.taskName, {
    status: "merged",
    merged: new Date().toISOString(),
  });
  writeSyncState(updated, repoRoot);

  console.log(pc.bold("paw merge --continue\n"));
  success(conflictTask.taskName, "conflict resolved");

  return updated;
}

/**
 * Iterate tasks, merge each one, stop on first conflict.
 * Updates sync state after each merge result.
 */
function runMergeLoop(
  initialState: SyncState,
  worktrees: WorktreeInfo[],
  target: string,
  repoRoot: string,
): void {
  let state = initialState;

  for (const wt of worktrees) {
    const mergeEntry = state.merges?.[wt.taskName];

    if (mergeEntry?.status === "merged") {
      skip(wt.taskName, "already merged");
      continue;
    }
    if (mergeEntry?.status === "skipped") {
      skip(wt.taskName, "no commits");
      continue;
    }
    if (mergeEntry?.status === "conflict") {
      warn(wt.taskName, "unresolved conflict");
      console.log(
        pc.yellow(
          "\nResolve the conflict, commit, then run: paw merge --continue",
        ),
      );
      return;
    }

    const commits = getCommitCount(wt.branch, target, repoRoot);
    if (commits === 0) {
      state = updateMergeEntry(state, wt.taskName, { status: "skipped" });
      writeSyncState(state, repoRoot);
      skip(wt.taskName, "no commits");
      continue;
    }

    const result = mergeBranch(wt.branch, repoRoot);
    if (result.success) {
      state = updateMergeEntry(state, wt.taskName, {
        status: "merged",
        merged: new Date().toISOString(),
      });
      writeSyncState(state, repoRoot);
      success(wt.taskName, "merged clean");
    } else {
      state = updateMergeEntry(state, wt.taskName, { status: "conflict" });
      writeSyncState(state, repoRoot);
      warn(wt.taskName, "conflicts");
      console.log(pc.dim(`    ${result.message.split("\n")[0]}`));
      console.log(
        pc.yellow(
          "\nResolve the conflict, commit, then run: paw merge --continue",
        ),
      );
      return;
    }
  }
}
