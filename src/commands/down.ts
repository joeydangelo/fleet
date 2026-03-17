import { Command } from 'commander';
import pc from 'picocolors';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { removeWorktree, branchExists, deleteBranch, cleanupBackupRefs } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { removeSyncWorktree, archiveSession } from '../lib/sync.js';
import { SYNC_BRANCH } from '../lib/constants.js';
import { createTmuxService } from '../lib/tmux.js';
import { killDetachedAgents, killOrphanedAgentSessions } from '../lib/pane-state.js';
import { killReviewerSessions } from '../lib/reviewer.js';
import {
  success,
  error,
  skip,
  pending,
  toErrorMessage,
  handleError,
  colors,
} from '../lib/output.js';
import { writeDefaultFleetYaml } from '../lib/util.js';

/**
 * State files cleaned up during `fleet down`. Must be updated when new
 * session-scoped state files are added to .fleet/.
 */
const SESSION_STATE_FILES = [
  '.last-inbox-check',
  '.session-ready',
  'health.json',
  'panes.json',
  'state.yml',
] as const;

/** Prefix for per-task inbox cursor files. */
const INBOX_CURSOR_PREFIX = '.inbox-cursor-';

/** Subdirectories removed during cleanup. */
const SESSION_STATE_DIRS = ['heartbeats', 'nudges', 'triage'] as const;

/** CLI command: tear down a fleet session (remove worktrees, kill agents, archive, reset config). */
export function downCommand(): Command {
  return new Command('down')
    .description('Remove all task worktrees and clean up')
    .option('--dry-run', 'Show what would be removed without making changes')
    .action((opts: { dryRun?: boolean }) => {
      try {
        const { repoRoot, config } = loadRepoConfig();
        const worktrees = planWorktrees(config, repoRoot);

        console.log(pc.bold(`fleet down${opts.dryRun ? ' (dry run)' : ''}\n`));

        if (opts.dryRun) {
          for (const wt of worktrees) {
            if (existsSync(wt.worktreePath)) {
              pending(wt.taskName, `would remove ${wt.worktreePath}`);
            } else {
              skip(wt.taskName, 'already removed');
            }
          }
          console.log(pc.dim('\nDry run -- no changes made.'));
          return;
        }

        let removed = 0;
        let failed = 0;

        for (const wt of worktrees) {
          if (!existsSync(wt.worktreePath)) {
            skip(wt.taskName, 'already removed');
            continue;
          }

          try {
            removeWorktree(wt.worktreePath, repoRoot);
            removed++;
            success(wt.taskName, 'worktree removed');
          } catch (err) {
            failed++;
            const message = toErrorMessage(err);
            error(wt.taskName, `failed: ${message}`);
          }
        }

        if (failed > 0) {
          console.log(
            colors.warn(
              `\n${failed} worktree(s) could not be removed (files may be in use).` +
                '\nClose terminals and editors in the worktree directories, then retry `fleet down`.' +
                '\nConfig and sync branch left intact for retry.',
            ),
          );
          process.exit(1);
        }

        try {
          const tmux = createTmuxService();
          killDetachedAgents(tmux, repoRoot);
          killOrphanedAgentSessions(tmux, repoRoot);
          killReviewerSessions(tmux);
        } catch {
          // tmux may not be available (e.g. running outside WSL)
        }

        cleanupBackupRefs(repoRoot);

        const runDir = resolve(repoRoot, '.fleet', 'run');
        try {
          rmSync(runDir, { recursive: true });
        } catch {
          /* already gone */
        }
        try {
          const fleetDir = resolve(repoRoot, '.fleet');
          const stateFileSet = new Set<string>(SESSION_STATE_FILES);
          for (const f of readdirSync(fleetDir)) {
            if (f.startsWith(INBOX_CURSOR_PREFIX) || stateFileSet.has(f)) {
              rmSync(resolve(fleetDir, f), { force: true });
            }
          }
          for (const d of SESSION_STATE_DIRS) {
            const p = resolve(fleetDir, d);
            if (existsSync(p)) rmSync(p, { recursive: true });
          }
        } catch {
          /* best-effort cleanup */
        }

        try {
          const archivePath = archiveSession(repoRoot, config.target);
          if (archivePath) {
            success('archive', archivePath);
          }
        } catch (err) {
          const message = toErrorMessage(err);
          error('archive', `failed: ${message}`);
        }

        try {
          if (writeDefaultFleetYaml(repoRoot)) {
            success('config', 'reset .fleet/fleet.yaml to template');
          }
        } catch {
          // Non-critical -- skip silently
        }

        try {
          removeSyncWorktree(repoRoot);
        } catch {
          // already removed
        }
        if (branchExists(SYNC_BRANCH, repoRoot)) {
          try {
            deleteBranch(SYNC_BRANCH, repoRoot);
            console.log(`\n${pc.dim(`Removed ${removed} worktree(s). Sync branch deleted.`)}`);
          } catch {
            console.log(
              `\n${pc.dim(`Removed ${removed} worktree(s). Failed to delete sync branch.`)}`,
            );
          }
        } else {
          console.log(`\n${pc.dim(`Removed ${removed} worktree(s).`)}`);
        }

        console.log(pc.dim('Task branches kept. Use git branch -d to clean up manually.'));
      } catch (err) {
        handleError(err);
      }
    });
}
