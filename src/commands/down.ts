import { Command } from 'commander';
import pc from 'picocolors';
import { existsSync } from 'node:fs';
import {
  getRepoRoot,
  removeWorktree,
  branchExists,
  deleteBranch,
  cleanupBackupRefs,
} from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { removeSyncWorktree, archiveSession } from '../lib/sync.js';
import { success, error, skip, pending, handleError } from '../lib/output.js';

export function downCommand(): Command {
  return new Command('down')
    .description('Remove all task worktrees and clean up')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--dry-run', 'Show what would be removed without making changes')
    .option('--keep-branches', 'Keep branches after removing worktrees', false)
    .option('--no-archive', 'Skip archiving session data to .paw/sessions/')
    .action(
      (opts: { config?: string; dryRun?: boolean; keepBranches: boolean; archive: boolean }) => {
        try {
          const repoRoot = getRepoRoot();
          const configPath = opts.config ?? resolveConfigPath(repoRoot);
          const config = loadConfig(configPath);
          const worktrees = planWorktrees(config, repoRoot);

          console.log(pc.bold(`paw down${opts.dryRun ? ' (dry run)' : ''}\n`));

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
              const message = err instanceof Error ? err.message : String(err);
              error(wt.taskName, `failed: ${message}`);
            }
          }

          // Remove backup refs
          cleanupBackupRefs(repoRoot);

          // Archive session data before destroying it
          if (opts.archive) {
            try {
              const archivePath = archiveSession(repoRoot, config.target);
              if (archivePath) {
                success('archive', archivePath);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              error('archive', `failed: ${message}`);
            }
          }

          // Remove sync worktree, then delete sync branch
          const SYNC_BRANCH = 'paw-sync';
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

          if (!opts.keepBranches) {
            console.log(pc.dim('Branches kept. Use git branch -d to clean up manually.'));
          }
        } catch (err) {
          handleError(err);
        }
      },
    );
}
