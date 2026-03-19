import { Command } from 'commander';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { getWorktreeProgress } from '../lib/worktree-stats.js';
import { loadSessionContext } from '../lib/session-context.js';
import { readMessages } from '../lib/messages.js';
import { livenessMarker } from '../lib/tmux.js';
import { tryGetLivenessMap } from '../lib/util.js';
import {
  error,
  skip,
  unknown,
  handleError,
  formatFocusAreas,
  formatTaskStatus,
} from '../lib/output.js';

/** CLI command: check progress of all task worktrees in the session. */
export function statusCommand(): Command {
  return new Command('status').description('Check progress of all task worktrees').action(() => {
    try {
      const { repoRoot, config, worktrees, syncState } = loadSessionContext();
      const livenessMap = tryGetLivenessMap(repoRoot);

      console.log(pc.bold('fleet status\n'));

      for (const wt of worktrees) {
        const taskSync = syncState?.tasks[wt.taskName];
        const exists = existsSync(wt.worktreePath);
        const alive = livenessMap.get(wt.taskName);
        const marker = livenessMarker(alive);

        if (!exists) {
          error(wt.taskName, 'worktree not found');
          continue;
        }

        if (taskSync?.status === 'done' || taskSync?.status === 'in_review') {
          skip(wt.taskName, formatTaskStatus(taskSync.status));
          continue;
        }

        try {
          const { commits, files } = getWorktreeProgress(wt.branch, config.target, repoRoot);

          const syncLabel = taskSync?.status === 'in_progress' ? ' [claimed]' : '';
          const focus = formatFocusAreas(taskSync?.focus);
          const focusSuffix = focus ? `  ${focus}` : '';

          if (commits === 0) {
            console.log(`  ${marker} ${wt.taskName} -- no changes yet${syncLabel}${focusSuffix}`);
          } else {
            console.log(
              `  ${marker} ${wt.taskName} -- ${commits} commit(s), ${files} file(s) changed${syncLabel}${focusSuffix}`,
            );
          }
        } catch {
          unknown(wt.taskName, 'unable to read status');
        }
      }

      const messageEntries = readMessages(repoRoot);
      const latestBroadcasts = new Map<string, string>();
      for (const entry of messageEntries) {
        if (entry.type === 'broadcast') {
          latestBroadcasts.set(entry.from, entry.msg);
        }
      }
      if (latestBroadcasts.size > 0) {
        console.log(pc.bold('\nLatest broadcasts:'));
        for (const [from, msg] of latestBroadcasts) {
          console.log(`  ${pc.dim(`[${from}]`)} ${msg}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });
}
