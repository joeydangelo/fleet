import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendJournalEntry, readJournal } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';

export function replyCommand(): Command {
  return new Command('reply')
    .description('Reply to the most recent directed message')
    .argument('<message>', 'Reply message')
    .option('--to <thread>', 'Reply to a specific message by thread ID')
    .action((message: string, opts: { to?: string }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        const state = readSyncState(repoRoot);
        requireSyncState(state);

        const all = readJournal(repoRoot);
        let resolvedSend: JournalEntry;

        if (opts.to) {
          // Find message by thread ID directed at this task
          const matches = all.filter(
            (e) => e.type === 'send' && e.to === taskName && e.thread === opts.to,
          );
          if (matches.length === 0) {
            // Check if thread exists but is directed at a different task
            const wrongTask = all.find(
              (e) => e.type === 'send' && e.thread === opts.to && e.to !== taskName,
            );
            if (wrongTask) {
              console.error(
                colors.error(
                  `Thread '${opts.to}' is directed at '${wrongTask.to}', not '${taskName}'.`,
                ),
              );
            } else {
              console.error(colors.error(`No message found with thread ID '${opts.to}'.`));
            }
            process.exit(1);
          }
          resolvedSend = matches[matches.length - 1]!;
        } else {
          // Find most recent message directed at this task
          const sends = all.filter((e) => e.type === 'send' && e.to === taskName);
          if (sends.length === 0) {
            console.error(colors.warn('No messages to reply to.'));
            process.exit(1);
          }
          resolvedSend = sends[sends.length - 1]!;
        }

        const thread = resolvedSend.thread;
        appendJournalEntry(
          taskName,
          {
            type: 'reply',
            to: resolvedSend.from,
            msg: message,
            ...(thread ? { thread } : {}),
          },
          repoRoot,
        );

        const prefix = thread ? `(${thread}) ` : '';
        console.log(colors.success(`[${taskName} → ${resolvedSend.from}] ${prefix}${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
