import { Command } from 'commander';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { getRepoRoot, getCommitCount, getChangedFileCount } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { readJournal } from '../lib/journal.js';
import {
  success,
  error,
  warn,
  pending,
  skip,
  unknown,
  handleError,
  formatFocusAreas,
} from '../lib/output.js';

export function statusCommand(): Command {
  return new Command('status')
    .description('Check progress of all task worktrees')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .action((opts: { config?: string }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);
        const worktrees = planWorktrees(config, repoRoot);
        const syncState = readSyncState(repoRoot);

        console.log(pc.bold('paw status\n'));

        for (const wt of worktrees) {
          const taskSync = syncState?.tasks[wt.taskName];
          const exists = existsSync(wt.worktreePath);

          if (!exists) {
            error(wt.taskName, 'worktree not found');
            continue;
          }

          if (taskSync?.status === 'done') {
            skip(wt.taskName, 'done');
            continue;
          }

          try {
            const commits = getCommitCount(wt.branch, config.target, repoRoot);
            const files = commits > 0 ? getChangedFileCount(wt.branch, config.target, repoRoot) : 0;

            const syncLabel = taskSync?.status === 'in_progress' ? ' [claimed]' : '';
            const focus = formatFocusAreas(taskSync?.focus);
            const focusSuffix = focus ? `  ${focus}` : '';

            if (commits === 0) {
              pending(wt.taskName, `no changes yet${syncLabel}${focusSuffix}`);
            } else {
              success(
                wt.taskName,
                `${commits} commit(s), ${files} file(s) changed${syncLabel}${focusSuffix}`,
              );
            }
          } catch {
            unknown(wt.taskName, 'unable to read status');
          }
        }

        // Show latest broadcast per agent
        const journalEntries = readJournal(repoRoot);
        const latestBroadcasts = new Map<string, string>();
        for (const entry of journalEntries) {
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

        if (syncState?.merges) {
          console.log(pc.bold('\nMerge state:'));
          for (const wt of worktrees) {
            const entry = syncState.merges[wt.taskName];
            if (!entry) continue;
            switch (entry.status) {
              case 'merged':
                success(wt.taskName, `merged${entry.merged ? ` at ${entry.merged}` : ''}`);
                break;
              case 'skipped':
                skip(wt.taskName, 'skipped (no commits)');
                break;
              case 'conflict':
                warn(wt.taskName, 'conflict (unresolved)');
                break;
              case 'pending':
                pending(wt.taskName, 'pending');
                break;
            }
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
