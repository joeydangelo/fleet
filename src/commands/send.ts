import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readRequiredSyncState } from '../lib/sync.js';
import { appendMessage, generateThreadId } from '../lib/messages.js';
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
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        const state = readRequiredSyncState(repoRoot);

        if (!state.tasks[task]) {
          console.error(colors.error(`Task '${task}' not found in session.`));
          process.exit(1);
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
