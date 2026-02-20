import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendJournalEntry } from '../lib/journal.js';
import { requireSyncState, handleError } from '../lib/output.js';

export function broadcastCommand(): Command {
  return new Command('broadcast')
    .description('Broadcast a message to all agents')
    .argument('<message>', 'Message to broadcast')
    .action((message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        const state = readSyncState(repoRoot);
        requireSyncState(state);

        appendJournalEntry(taskName, { type: 'broadcast', msg: message }, repoRoot);

        console.log(pc.green(`[${taskName} → all] ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
