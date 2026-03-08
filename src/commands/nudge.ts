import { Command } from 'commander';
import { appendMessage } from '../lib/messages.js';
import { handleError, success } from '../lib/output.js';

/** Build the `paw nudge` CLI command. */
export function nudgeCommand(): Command {
  return new Command('nudge')
    .description('Send a nudge message to an agent')
    .argument('<task>', 'Task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        appendMessage('orchestrator', {
          type: 'nudge',
          to: task,
          msg: message,
        });
        success(task, 'nudge delivered');
      } catch (err) {
        handleError(err);
      }
    });
}
