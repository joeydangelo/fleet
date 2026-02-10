import { Command } from "commander";
import { existsSync } from "node:fs";
import pc from "picocolors";
import { getRepoRoot, getCommitCount, getChangedFileCount } from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { planWorktrees } from "../lib/session.js";
import { readSyncState } from "../lib/sync.js";
import { success, error, pending, skip, unknown, handleError } from "../lib/output.js";

export function statusCommand(): Command {
  return new Command("status")
    .description("Check progress of all task worktrees")
    .option("-c, --config <path>", "Path to paw.yaml")
    .action((opts: { config?: string }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);
        const worktrees = planWorktrees(config, repoRoot);
        const syncState = readSyncState(repoRoot);

        console.log(pc.bold("paw status\n"));

        for (const wt of worktrees) {
          const taskSync = syncState?.tasks[wt.taskName];
          const exists = existsSync(wt.worktreePath);

          if (!exists) {
            error(wt.taskName, "worktree not found");
            continue;
          }

          if (taskSync?.status === "completed") {
            skip(wt.taskName, "completed");
            continue;
          }

          try {
            const commits = getCommitCount(wt.branch, config.target, repoRoot);
            const files = commits > 0
              ? getChangedFileCount(wt.branch, config.target, repoRoot)
              : 0;

            const syncLabel = taskSync?.status === "in_progress" ? " [claimed]" : "";

            if (commits === 0) {
              pending(wt.taskName, `no changes yet${syncLabel}`);
            } else {
              success(wt.taskName, `${commits} commit(s), ${files} file(s) changed${syncLabel}`);
            }
          } catch {
            unknown(wt.taskName, "unable to read status");
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
