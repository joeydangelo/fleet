import { Command } from "commander";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { getRepoRoot, removeWorktree } from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { planWorktrees } from "../lib/session.js";
import { success, error, skip, handleError } from "../lib/output.js";

export function downCommand(): Command {
  return new Command("down")
    .description("Remove all task worktrees and clean up")
    .option("-c, --config <path>", "Path to paw.yaml")
    .option(
      "--keep-branches",
      "Keep branches after removing worktrees",
      false,
    )
    .action((opts: { config?: string; keepBranches: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);
        const worktrees = planWorktrees(config, repoRoot);

        console.log(pc.bold("paw down\n"));

        let removed = 0;

        for (const wt of worktrees) {
          if (!existsSync(wt.worktreePath)) {
            skip(wt.taskName, "already removed");
            continue;
          }

          try {
            removeWorktree(wt.worktreePath, repoRoot);
            removed++;
            success(wt.taskName, "worktree removed");
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            error(wt.taskName, `failed: ${message}`);
          }
        }

        console.log(
          `\n${pc.dim(`Removed ${removed} worktree(s).`)}`,
        );

        if (!opts.keepBranches) {
          console.log(
            pc.dim("Branches kept. Use git branch -d to clean up manually."),
          );
        }
      } catch (err) {
        handleError(err);
      }
    });
}
