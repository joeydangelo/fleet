import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendJournalEntry } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

/** Entry with optional thread (schema task adds this to JournalEntry). */
type ThreadedEntry = JournalEntry & { thread?: string };

/** Generate a 4-char base-36 thread ID. Schema task exports this from journal.ts. */
function generateThreadId(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function askCommand(): Command {
  return new Command('ask')
    .description('Send a directed message to a specific agent')
    .argument('<task>', 'Target task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot) ?? 'orchestrator';

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red('No sync state found. Run `paw up` first.'));
          process.exit(1);
        }

        if (!state.tasks[task]) {
          console.error(pc.red(`Task '${task}' not found in session.`));
          process.exit(1);
        }

        const thread = generateThreadId();
        appendJournalEntry(
          taskName,
          { type: 'ask', to: task, msg: message, thread } as ThreadedEntry,
          repoRoot,
        );

        console.log(pc.green(`[${taskName} → ${task}] (${thread}) ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
