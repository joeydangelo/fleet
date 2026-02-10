import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import { readSyncState, claimTask, writeSyncState } from "../lib/sync.js";
import { handleError } from "../lib/output.js";

export function primeCommand(): Command {
  return new Command("prime")
    .description("Orient agent and claim task (run inside a worktree)")
    .action(() => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(
            pc.red("Could not detect task name. Are you in a paw worktree?"),
          );
          console.error(
            pc.dim(
              "Expected a single .md file in .paw/tasks/. Run `paw up` to create worktrees.",
            ),
          );
          process.exit(1);
        }

        console.log(pc.bold(`paw prime: ${taskName}\n`));

        // Read and display task file
        const taskFile = resolve(repoRoot, ".paw", "tasks", `${taskName}.md`);
        if (existsSync(taskFile)) {
          const content = readFileSync(taskFile, "utf-8");
          console.log(content);
        } else {
          console.log(pc.yellow("No task file found at " + taskFile));
        }

        // Claim on sync branch
        const state = readSyncState(repoRoot);
        if (state && state.tasks[taskName]) {
          const updated = claimTask(state, taskName);
          writeSyncState(updated, repoRoot);
          console.log(pc.green(`Claimed task: ${taskName}\n`));

          // Show other agents' status
          const otherTasks = Object.entries(updated.tasks).filter(
            ([name]) => name !== taskName,
          );
          if (otherTasks.length > 0) {
            console.log(pc.bold("Other tasks:"));
            for (const [name, task] of otherTasks) {
              const statusColor =
                task.status === "completed"
                  ? pc.green
                  : task.status === "in_progress"
                    ? pc.yellow
                    : pc.dim;
              console.log(`  ${statusColor(task.status.padEnd(12))} ${name}`);
            }
            console.log();
          }
        } else {
          console.log(pc.dim("No sync state found. Run `paw up` first.\n"));
        }

        // Usage guide
        console.log(pc.dim("-- Workflow --"));
        console.log(pc.dim("1. Work on the task, committing as you go"));
        console.log(pc.dim("2. Run `paw status` to check overall progress"));
        console.log(pc.dim("3. Run `paw done` when finished"));
      } catch (err) {
        handleError(err);
      }
    });
}
