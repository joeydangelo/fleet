import { Command } from 'commander';
import { getRepoRoot } from '../lib/git.js';
import { writeNudge } from '../lib/health.js';
import { handleError, success } from '../lib/output.js';

export function nudgeCommand(): Command {
  return new Command('nudge')
    .description('Send a message to an agent via file-based delivery')
    .argument('<task>', 'Task name')
    .argument('<message>', 'Message to send')
    .action((task: string, message: string) => {
      try {
        const repoRoot = getRepoRoot();
        writeNudge(repoRoot, task, message);
        success(task, 'nudge delivered');
      } catch (err) {
        handleError(err);
      }
    });
}
