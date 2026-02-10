import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import {
  readSyncState,
  claimTask,
  writeSyncState,
  readSyncFile,
} from "../lib/sync.js";
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

          // Show team status
          const separator = pc.dim("────────────────────────────────────────");
          const otherTasks = Object.entries(updated.tasks).filter(
            ([name]) => name !== taskName,
          );
          if (otherTasks.length > 0) {
            console.log(separator);
            console.log(pc.bold("Team Status"));
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

          // Show completed summaries
          const completedTasks = Object.entries(updated.tasks).filter(
            ([name, task]) => name !== taskName && task.status === "completed",
          );
          if (completedTasks.length > 0) {
            console.log(separator);
            console.log(pc.bold("Completed Summaries\n"));
            for (const [name] of completedTasks) {
              const summary = readSyncFile(`summaries/${name}.md`, repoRoot);
              if (summary) {
                console.log(pc.bold(`### ${name}`));
                console.log(summary);
                console.log();
              }
            }
          }
        } else {
          console.log(pc.dim("No sync state found. Run `paw up` first.\n"));
        }

        // Usage guide
        console.log(pc.dim("── Workflow ──"));
        console.log(pc.dim("1. Work on the task, committing as you go"));
        console.log(
          pc.dim(
            '2. Run `paw broadcast "..."` when you make significant changes',
          ),
        );
        console.log(
          pc.dim("3. Run `paw check` to read messages from other agents"),
        );
        console.log(
          pc.dim("4. Run `paw done` when finished (include a --summary)"),
        );
      } catch (err) {
        handleError(err);
      }
    });
}
