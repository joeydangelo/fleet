import { Command } from 'commander';
import { requireFleetSession } from '../lib/session-context.js';
import { appendMessage } from '../lib/messages.js';
import { handleError, success } from '../lib/output.js';
import { emitEvent } from '../lib/feed.js';

/** Build the `fleet nudge` CLI command. */
export function nudgeCommand(): Command {
  return new Command('nudge')
    .description('Send a nudge message to an agent via the inbox')
    .argument('<task>', 'Task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const { repoRoot, taskName: sender } = requireFleetSession();
        appendMessage(
          sender,
          {
            type: 'nudge',
            to: task,
            msg: message,
          },
          repoRoot,
        );
        emitEvent({ event: 'fleet.nudge', to: task, msg: message });
        success(task, 'nudge delivered');
      } catch (err) {
        handleError(err);
      }
    });
}
