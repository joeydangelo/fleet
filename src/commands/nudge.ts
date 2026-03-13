import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { readRequiredSyncState } from '../lib/sync.js';
import { appendMessage } from '../lib/messages.js';
import { handleError, success } from '../lib/output.js';

/** Build the `paw nudge` CLI command. */
export function nudgeCommand(): Command {
  return new Command('nudge')
    .description('Send a nudge message to an agent via the inbox')
    .argument('<task>', 'Task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        readRequiredSyncState(repoRoot);

        appendMessage(
          'orchestrator',
          {
            type: 'nudge',
            to: task,
            msg: message,
          },
          repoRoot,
        );
        success(task, 'nudge delivered');
      } catch (err) {
        handleError(err);
      }
    });
}
