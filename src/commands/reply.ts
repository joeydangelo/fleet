import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readRequiredSyncState } from '../lib/sync.js';
import { appendMessage, readMessages } from '../lib/messages.js';
import { handleError, colors } from '../lib/output.js';
import { computeThreads, writeGateFlag, clearGateFlag } from './inbox.js';

/** CLI command: reply to a direct message from an agent. */
export function replyCommand(): Command {
  return new Command('reply')
    .description('Reply to a direct message from an agent')
    .argument('<task>', 'Target task to reply to')
    .argument('<message>', 'Reply message')
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        readRequiredSyncState(repoRoot);

        const all = readMessages(repoRoot);

        // Thread IDs that already have a reply from this agent
        const repliedThreads = new Set(
          all
            .filter((e) => e.type === 'reply' && e.from === taskName && e.thread)
            .map((e) => e.thread!),
        );

        // Find unanswered sends from the target task directed at this agent
        const unanswered = all.filter(
          (e) =>
            e.type === 'send' &&
            e.from === task &&
            e.to === taskName &&
            (!e.thread || !repliedThreads.has(e.thread)),
        );

        if (unanswered.length === 0) {
          console.error(colors.warn(`No unanswered messages from '${task}'.`));
          process.exit(1);
        }

        const target = unanswered[0]!;

        appendMessage(
          taskName,
          {
            type: 'reply',
            to: task,
            msg: message,
            ...(target.thread ? { thread: target.thread } : {}),
          },
          repoRoot,
        );

        console.log(colors.success(`[${taskName} → ${task}] ${message}`));

        // Re-check for remaining unanswered sends directed at this task
        const updated = readMessages(repoRoot);
        const { open } = computeThreads(updated);
        const remaining = open.filter((t) => t.send.to === taskName);
        if (remaining.length > 0) {
          writeGateFlag(repoRoot, taskName, remaining);
        } else {
          clearGateFlag(repoRoot, taskName);
        }
      } catch (err) {
        handleError(err);
      }
    });
}
