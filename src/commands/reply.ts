import { Command } from 'commander';
import { requireFleetSession } from '../lib/session-context.js';
import { readMessages, replyToMessage } from '../lib/messages.js';
import { CLIError } from '../lib/errors.js';
import { handleError, colors } from '../lib/output.js';
import { computeThreads, writeGateFlag, clearGateFlag } from './inbox.js';
import { emitEvent } from '../lib/feed.js';

/** CLI command: reply to a direct message from an agent. */
export function replyCommand(): Command {
  return new Command('reply')
    .description('Reply to a direct message from an agent')
    .argument('<task>', 'Target task to reply to')
    .argument('<message>', 'Reply message')
    .action((task: string, message: string) => {
      try {
        const { repoRoot, taskName } = requireFleetSession();

        const reply = replyToMessage(taskName, task, message, repoRoot);

        if (!reply) {
          throw new CLIError(`No unanswered messages from '${task}'.`);
        }

        emitEvent({ event: 'fleet.reply', to: task, msg: message });
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
