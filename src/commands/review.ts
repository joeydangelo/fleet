import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState, submitForReview, writeSyncState } from '../lib/sync.js';
import { requireSyncState, handleError, colors } from '../lib/output.js';

export function reviewCommand(): Command {
  return new Command('review')
    .description('Submit task for review — push your branch and create a PR first')
    .action(() => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(colors.error('Could not detect task name. Are you in a paw worktree?'));
          console.error(pc.dim('Expected a single .md file in .paw/tasks/.'));
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        requireSyncState(state);

        if (!state.tasks[taskName]) {
          console.error(colors.error(`Task '${taskName}' not found in sync state.`));
          process.exit(1);
        }

        const updated = submitForReview(state, taskName);
        writeSyncState(updated, repoRoot);
        console.log(colors.success(`+ ${taskName} -- submitted for review`));
      } catch (err) {
        handleError(err);
      }
    });
}
