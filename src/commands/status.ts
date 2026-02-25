import { Command } from 'commander';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { getCommitCount, getChangedFileCount } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { readJournal } from '../lib/journal.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { checkAgentLiveness, createTmuxService } from '../lib/tmux.js';
import type { AgentLivenessResult } from '../lib/tmux.js';
import { error, skip, unknown, handleError, formatFocusAreas } from '../lib/output.js';

/** Build a taskName → alive map from liveness results. */
function buildLivenessMap(results: AgentLivenessResult[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const r of results) {
    map.set(r.taskName, r.alive);
  }
  return map;
}

/** Format a liveness marker: ● alive, ○ dead. */
function livenessMarker(alive: boolean | undefined): string {
  if (alive === undefined) return ' ';
  return alive ? pc.green('●') : pc.red('○');
}

export function statusCommand(): Command {
  return new Command('status')
    .description('Check progress of all task worktrees')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .action((opts: { config?: string }) => {
      try {
        const { repoRoot, config } = loadRepoConfig(opts.config);
        const worktrees = planWorktrees(config, repoRoot);
        const syncState = readSyncState(repoRoot);

        // Check tmux liveness when panes.json exists
        let livenessMap = new Map<string, boolean>();
        const paneConfig = readPaneConfig(repoRoot);
        if (paneConfig) {
          try {
            const tmux = createTmuxService();
            const results = checkAgentLiveness(tmux, paneConfig);
            livenessMap = buildLivenessMap(results);
          } catch {
            // tmux not available — skip liveness check
          }
        }

        console.log(pc.bold('paw status\n'));

        for (const wt of worktrees) {
          const taskSync = syncState?.tasks[wt.taskName];
          const exists = existsSync(wt.worktreePath);
          const alive = livenessMap.get(wt.taskName);
          const marker = livenessMarker(alive);

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
      } catch (err) {
        handleError(err);
      }
    });
}
