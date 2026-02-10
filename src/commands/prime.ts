import { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { getCurrentBranch, getRepoRoot } from "../lib/git.js";
import { readSyncState, claimTask, writeSyncState } from "../lib/sync.js";

export function primeCommand(): Command {
  return new Command("prime")
    .description("Orient agent and claim task (run inside a worktree)")
    .action(() => {
      const repoRoot = getRepoRoot();
      const taskName = detectTaskName(repoRoot);

      if (!taskName) {
        console.error(
          pc.red("Could not detect task name. Are you in a paw worktree?"),
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
              task.status === "completed" ? pc.green :
              task.status === "in_progress" ? pc.yellow :
              pc.dim;
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
    });
}

function detectTaskName(cwd: string): string | null {
  // Try branch name: target/taskName
  const branch = getCurrentBranch(cwd);
  const lastSlash = branch.lastIndexOf("/");
  if (lastSlash >= 0) {
    const candidate = branch.slice(lastSlash + 1);
    if (candidate) return candidate;
  }

  // Fallback: check .paw/tasks/ for a single task file
  const tasksDir = resolve(cwd, ".paw", "tasks");
  if (existsSync(tasksDir)) {
    const files = readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
    const singleFile = files.length === 1 ? files[0] : undefined;
    if (singleFile) {
      return singleFile.replace(/\.md$/, "");
    }
  }

  return null;
}
