import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendJournalEntry, readJournal } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

export function replyCommand(): Command {
  return new Command('reply')
    .description('Reply to the most recent directed message')
    .argument('<message>', 'Reply message')
    .action((message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot) ?? 'orchestrator';

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red('No sync state found. Run `paw up` first.'));
          process.exit(1);
        }

        // Find most recent ask directed at this task
        const all = readJournal(repoRoot);
        const asks = all.filter((e) => e.type === 'ask' && e.to === taskName);

        if (asks.length === 0) {
          console.error(pc.yellow('No messages to reply to.'));
          process.exit(1);
        }

        const lastAsk = asks[asks.length - 1]!;

        appendJournalEntry(taskName, { type: 'reply', to: lastAsk.from, msg: message }, repoRoot);

        console.log(pc.green(`[${taskName} → ${lastAsk.from}] ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
