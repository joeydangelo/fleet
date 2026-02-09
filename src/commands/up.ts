import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { loadConfig, resolveConfigPath } from "../lib/config.js";
import { createSession, writeHandoffs } from "../lib/session.js";
import { success } from "../lib/output.js";

export function upCommand(): Command {
  return new Command("up")
    .description("Create worktrees and branches for all tasks")
    .option("-c, --config <path>", "Path to paw.yaml")
    .action((opts: { config?: string }) => {
      const repoRoot = getRepoRoot();
      const configPath = opts.config ?? resolveConfigPath(repoRoot);
      const config = loadConfig(configPath);

      console.log(
        pc.bold(`paw up: ${Object.keys(config.tasks).length} tasks`),
      );
      console.log(`  base:   ${config.base}`);
      console.log(`  target: ${config.target}\n`);

      const worktrees = createSession(config, repoRoot);

      for (const wt of worktrees) {
        success(wt.taskName, wt.worktreePath);
      }

      const handoffPath = writeHandoffs(config, worktrees, repoRoot);
      console.log(`\n${pc.dim("Handoffs written to")} ${handoffPath}`);
      console.log(
        pc.dim(
          "\nOpen a Claude Code window in each worktree path to begin.",
        ),
      );
    });
}
