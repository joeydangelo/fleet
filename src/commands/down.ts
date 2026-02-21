import { Command } from 'commander';
import pc from 'picocolors';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { removeWorktree, branchExists, deleteBranch, cleanupBackupRefs } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { removeSyncWorktree, archiveSession } from '../lib/sync.js';
import { SYNC_BRANCH } from '../lib/constants.js';
import { readDoc } from '../lib/docs.js';
import { createTmuxService } from '../lib/tmux.js';
import { killPanes } from '../lib/pane-state.js';
import {
  success,
  error,
  skip,
  pending,
  toErrorMessage,
  handleError,
  colors,
} from '../lib/output.js';

export function downCommand(): Command {
  return new Command('down')
    .description('Remove all task worktrees and clean up')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--dry-run', 'Show what would be removed without making changes')
    .option('--no-archive', 'Skip archiving session data to .paw/sessions/')
    .action((opts: { config?: string; dryRun?: boolean; archive: boolean }) => {
      try {
        const { repoRoot, config } = loadRepoConfig(opts.config);
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
                '\nClose terminals and editors in the worktree directories, then retry `paw down`.' +
                '\nConfig and sync branch left intact for retry.',
            ),
          );
          process.exit(1);
        }

        // Kill agent tmux panes
        try {
          const tmux = createTmuxService();
          killPanes(tmux, repoRoot);
        } catch {
          // tmux may not be available (e.g. running outside WSL)
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
            const message = toErrorMessage(err);
            error('archive', `failed: ${message}`);
          }
        }

        // Reset .paw/paw.yaml to template
        try {
          const doc = readDoc('templates', 'paw-yaml');
          if (doc) {
            const yamlMatch = doc.content.match(/```yaml\r?\n([\s\S]*?)```/);
            if (yamlMatch) {
              const configDir = resolve(repoRoot, '.paw');
              mkdirSync(configDir, { recursive: true });
              writeFileSync(resolve(configDir, 'paw.yaml'), yamlMatch[1]!);
              success('config', 'reset .paw/paw.yaml to template');
            }
          }
        } catch {
          // Non-critical -- skip silently
        }

        // Remove sync worktree, then delete sync branch
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
