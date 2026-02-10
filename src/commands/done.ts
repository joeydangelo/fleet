import { Command } from "commander";
import pc from "picocolors";
import { getCurrentBranch, getRepoRoot } from "../lib/git.js";
import { readSyncState, completeTask, writeSyncState } from "../lib/sync.js";

export function doneCommand(): Command {
  return new Command("done")
    .description("Mark current task as completed")
    .action(() => {
      const repoRoot = getRepoRoot();
      const branch = getCurrentBranch(repoRoot);
      const lastSlash = branch.lastIndexOf("/");
      const taskName = lastSlash >= 0 ? branch.slice(lastSlash + 1) : null;

      if (!taskName) {
        console.error(
          pc.red("Could not detect task name from branch. Are you in a paw worktree?"),
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
    });
}
