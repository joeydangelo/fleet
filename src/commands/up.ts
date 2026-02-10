import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { createSession, writeTaskFiles } from "../lib/session.js";
import { initSyncState, writeSyncState } from "../lib/sync.js";
import { success } from "../lib/output.js";

export function upCommand(): Command {
  return new Command("up")
    .description("Create worktrees and branches for all tasks")
    .option("-c, --config <path>", "Path to paw.yaml")
    .action((opts: { config?: string }) => {
      const repoRoot = getRepoRoot();
      const configPath = opts.config ?? resolveConfigPath(repoRoot);
      const config = loadConfig(configPath);
      const taskNames = Object.keys(config.tasks);

      console.log(pc.bold(`paw up: ${taskNames.length} tasks`));
      console.log(`  base:   ${config.base}`);
      console.log(`  target: ${config.target}\n`);

      const worktrees = createSession(config, repoRoot);
      writeTaskFiles(config, worktrees);

      // Initialize sync branch with all tasks as pending
      const syncState = initSyncState(config.target, taskNames, configPath);
      writeSyncState(syncState, repoRoot);

      for (const wt of worktrees) {
        success(wt.taskName, wt.worktreePath);
      }

      console.log(
        pc.dim(
          "\nOpen an agent session in each worktree path to begin.",
        ),
      );
    });
}
