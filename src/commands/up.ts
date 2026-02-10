import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import {
  createSession,
  planWorktrees,
  writeTaskFiles,
} from "../lib/session.js";
import { initSyncState, writeSyncStateAndFiles } from "../lib/sync.js";
import { success, pending, handleError } from "../lib/output.js";

export function upCommand(): Command {
  return new Command("up")
    .description("Create worktrees and branches for all tasks")
    .option("-c, --config <path>", "Path to paw.yaml")
    .option("--dry-run", "Show what would be created without making changes")
    .action((opts: { config?: string; dryRun?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);
        const taskNames = Object.keys(config.tasks);

        console.log(
          pc.bold(
            `paw up: ${taskNames.length} tasks${opts.dryRun ? " (dry run)" : ""}`,
          ),
        );
        console.log(`  base:   ${config.base}`);
        console.log(`  target: ${config.target}\n`);

        if (opts.dryRun) {
          const worktrees = planWorktrees(config, repoRoot);
          for (const wt of worktrees) {
            pending(wt.taskName, `${wt.branch} -> ${wt.worktreePath}`);
          }
          console.log(pc.dim("\nDry run -- no changes made."));
          return;
        }

        const worktrees = createSession(config, repoRoot);
        writeTaskFiles(config, worktrees);

        // Initialize sync branch with all tasks as pending + journal directory
        const syncState = initSyncState(config.target, taskNames, configPath);
        writeSyncStateAndFiles(
          syncState,
          [{ path: "journal/.gitkeep", content: "" }],
          repoRoot,
        );

        for (const wt of worktrees) {
          success(wt.taskName, wt.worktreePath);
        }

        console.log(
          pc.dim("\nOpen an agent session in each worktree path to begin."),
        );
      } catch (err) {
        handleError(err);
      }
    });
}
