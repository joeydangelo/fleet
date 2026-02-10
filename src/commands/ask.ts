import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import { readSyncState } from "../lib/sync.js";
import { appendJournalEntry } from "../lib/journal.js";
import { handleError } from "../lib/output.js";

export function askCommand(): Command {
  return new Command("ask")
    .description("Send a directed message to a specific agent")
    .argument("<task>", "Target task name")
    .argument("<message>", "Message to send")
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(
            pc.red("Could not detect task name. Are you in a paw worktree?"),
          );
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red("No sync state found. Run `paw up` first."));
          process.exit(1);
        }

        if (!state.tasks[task]) {
          console.error(pc.red(`Task '${task}' not found in session.`));
          process.exit(1);
        }

        appendJournalEntry(
          taskName,
          { type: "ask", to: task, msg: message },
          repoRoot,
        );

        console.log(pc.green(`[${taskName} → ${task}] ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
