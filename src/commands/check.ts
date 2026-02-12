import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readSyncState, writeSyncState } from '../lib/sync.js';
import { readJournalForTask } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

export function checkCommand(): Command {
  return new Command('check').description('Read new messages and broadcasts').action(() => {
    try {
      const repoRoot = getRepoRoot();
      const taskName = detectTaskName(repoRoot);

      if (!taskName) {
        console.error(pc.red('Could not detect task name. Are you in a paw worktree?'));
        process.exit(1);
      }

      const state = readSyncState(repoRoot);
      if (!state) {
        console.error(pc.red('No sync state found. Run `paw up` first.'));
        process.exit(1);
      }

      const lastCheck = state.lastCheck?.[taskName];
      const entries = readJournalForTask(taskName, repoRoot, lastCheck);

      if (entries.length === 0) {
        console.log(pc.dim('No new messages.'));
      } else {
        console.log(pc.bold(`paw check: ${entries.length} new message(s)\n`));

        for (const entry of entries) {
          const target = entry.to ? ` → ${entry.to}` : ' → all';
          const prefix = `[${entry.from}${target}]`;

          if (entry.to === taskName) {
            // Directed at this agent -- highlight
            console.log(`  ${pc.cyan(prefix)} ${entry.msg}`);
          } else {
            console.log(`  ${pc.dim(prefix)} ${entry.msg}`);
          }
        }
      }

      // Update last-check timestamp
      const now = new Date().toISOString();
      const updated = {
        ...state,
        lastCheck: {
          ...state.lastCheck,
          [taskName]: now,
        },
      };
      writeSyncState(updated, repoRoot);
    } catch (err) {
      handleError(err);
    }
  });
}
