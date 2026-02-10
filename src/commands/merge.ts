import { Command } from "commander";
import pc from "picocolors";
import {
  getRepoRoot,
  getCurrentBranch,
  mergeBranch,
  getCommitCount,
} from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { planWorktrees } from "../lib/session.js";
import { success, warn, skip, handleError } from "../lib/output.js";

export function mergeCommand(): Command {
  return new Command("merge")
    .description("Merge completed task branches into the target branch")
    .option("-c, --config <path>", "Path to paw.yaml")
    .option("--pick <task>", "Merge only a specific task")
    .action((opts: { config?: string; pick?: string }) => {
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

        const worktrees = planWorktrees(config, repoRoot);
        const toMerge = opts.pick
          ? worktrees.filter((wt) => wt.taskName === opts.pick)
          : worktrees;

        if (toMerge.length === 0) {
          console.error(pc.red(`Task '${opts.pick}' not found in config.`));
          process.exit(1);
        }

        console.log(pc.bold("paw merge\n"));

        let hasConflicts = false;

        for (const wt of toMerge) {
          const commits = getCommitCount(wt.branch, config.target, repoRoot);
          if (commits === 0) {
            skip(wt.taskName, "no commits");
            continue;
          }

          const result = mergeBranch(wt.branch, repoRoot);
          if (result.success) {
            success(wt.taskName, "merged clean");
          } else {
            hasConflicts = true;
            warn(wt.taskName, "conflicts");
            console.log(pc.dim(`    ${result.message.split("\n")[0]}`));
          }
        }

        if (hasConflicts) {
          console.log(
            pc.yellow("\nResolve conflicts, then run: paw merge --continue"),
          );
        }
      } catch (err) {
        handleError(err);
      }
    });
}
