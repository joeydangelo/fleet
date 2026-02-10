import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import { readSyncState, completeTask, writeSyncState } from "../lib/sync.js";
import { handleError } from "../lib/output.js";

export function doneCommand(): Command {
  return new Command("done")
    .description("Mark current task as completed")
    .action(() => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(
            pc.red("Could not detect task name. Are you in a paw worktree?"),
          );
          console.error(
            pc.dim("Expected a single .md file in .paw/tasks/. Run `paw up` to create worktrees."),
          );
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red("No sync state found. Run `paw up` first."));
          process.exit(1);
        }

        if (!state.tasks[taskName]) {
          console.error(pc.red(`Task '${taskName}' not found in sync state.`));
          process.exit(1);
        }

        const updated = completeTask(state, taskName);
        writeSyncState(updated, repoRoot);

        console.log(pc.green(`+ ${taskName} -- marked as completed`));
      } catch (err) {
        handleError(err);
      }
    });
}
