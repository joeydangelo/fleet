import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { getTaskIdentity } from '../lib/session.js';
import { readRequiredSyncState } from '../lib/sync.js';
import { appendMessage } from '../lib/messages.js';
import { handleError, colors } from '../lib/output.js';
import { emitEvent } from '../lib/feed.js';

/** CLI command: broadcast a message to all agents in the session. */
export function broadcastCommand(): Command {
  return new Command('broadcast')
    .description('Broadcast a message to all agents')
    .argument('<message>', 'Message to broadcast')
    .action((message: string) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = getTaskIdentity(repoRoot);

        readRequiredSyncState(repoRoot);

        appendMessage(taskName, { type: 'broadcast', msg: message }, repoRoot);
        emitEvent({ event: 'fleet.broadcast', msg: message });

        console.log(colors.success(`[${taskName} → all] ${message}`));
      } catch (err) {
        handleError(err);
      }
    });
}
