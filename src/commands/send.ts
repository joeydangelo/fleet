import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendJournalEntry, generateThreadId } from '../lib/journal.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';

/** Build the `paw send` CLI command. */
export function sendCommand(): Command {
  return new Command('send')
    .description('Send a directed message to a specific agent')
    .argument('<task>', 'Target task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        const state = readSyncState(repoRoot);
        requireSyncState(state);

        if (!state.tasks[task]) {
          console.error(colors.error(`Task '${task}' not found in session.`));
          process.exit(1);
        }

        const thread = generateThreadId();
        appendJournalEntry(taskName, { type: 'send', to: task, msg: message, thread }, repoRoot);

        console.log(colors.success(`[${taskName} → ${task}] (${thread}) ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
