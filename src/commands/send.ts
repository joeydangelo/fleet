import { Command } from 'commander';
import { requireFleetSession } from '../lib/session-context.js';
import { appendMessage, generateThreadId } from '../lib/messages.js';
import { CLIError } from '../lib/errors.js';
import { handleError, colors } from '../lib/output.js';
import { emitEvent } from '../lib/feed.js';

/** CLI command: send a direct message to an agent. */
export function sendCommand(): Command {
  return new Command('send')
    .description('Send a direct message to an agent')
    .argument('<task>', 'Target task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const { repoRoot, taskName, syncState } = requireFleetSession();

        if (!syncState.tasks[task]) {
          throw new CLIError(`Task '${task}' not found in session.`);
        }

        const thread = generateThreadId();
        appendMessage(taskName, { type: 'send', to: task, msg: message, thread }, repoRoot);
        emitEvent({ event: 'fleet.send', to: task, msg: message });

        console.log(colors.success(`[${taskName} → ${task}] (${thread}) ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
