import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { appendMessage, readMessages } from '../lib/messages.js';
import type { Message } from '../lib/messages.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';

/** CLI command: reply to the most recent or a specific directed message. */
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

        const all = readMessages(repoRoot);
        let resolvedSend: Message;

        if (opts.to) {
          const matches = all.filter(
            (e) => e.type === 'send' && e.to === taskName && e.thread === opts.to,
          );
          if (matches.length === 0) {
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
          const sends = all.filter((e) => e.type === 'send' && e.to === taskName);
          if (sends.length === 0) {
            console.error(colors.warn('No messages to reply to.'));
            process.exit(1);
          }
          resolvedSend = sends[sends.length - 1]!;
        }

        const thread = resolvedSend.thread;
        appendMessage(
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
