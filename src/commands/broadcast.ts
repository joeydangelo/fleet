import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import { readSyncState } from "../lib/sync.js";
import { appendJournalEntry } from "../lib/journal.js";
import { handleError } from "../lib/output.js";

export function broadcastCommand(): Command {
  return new Command("broadcast")
    .description("Broadcast a message to all agents")
    .argument("<message>", "Message to broadcast")
    .action((message: string) => {
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

        appendJournalEntry(taskName, { type: "broadcast", msg: message }, repoRoot);

        console.log(pc.green(`[${taskName} → all] ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
