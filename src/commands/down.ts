import { Command } from 'commander';
import pc from 'picocolors';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { removeWorktree, branchExists, deleteBranch, cleanupBackupRefs } from '../lib/git.js';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { removeSyncWorktree, archiveSession } from '../lib/sync.js';
import { SYNC_BRANCH } from '../lib/constants.js';
import { readDoc } from '../lib/docs.js';
import { createTmuxService } from '../lib/tmux.js';
import { killPanes, killDetachedAgents } from '../lib/pane-state.js';
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

/** CLI command: tear down a paw session (remove worktrees, kill agents, archive, reset config). */
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

        try {
          const tmux = createTmuxService();
          killPanes(tmux, repoRoot);
          killDetachedAgents(tmux, repoRoot);
          killReviewerSessions(tmux);
        } catch {
          // tmux may not be available (e.g. running outside WSL)
        }

        cleanupBackupRefs(repoRoot);

        const runDir = resolve(repoRoot, '.paw', 'run');
        try {
          rmSync(runDir, { recursive: true });
        } catch {
          /* already gone */
        }
        try {
          const pawDir = resolve(repoRoot, '.paw');
          for (const f of readdirSync(pawDir)) {
            if (
              f.startsWith('.inbox-cursor-') ||
              f === '.last-inbox-check' ||
              f === '.session-ready' ||
              f === 'health.json' ||
              f === 'panes.json' ||
              f === 'state.yml'
            ) {
              rmSync(resolve(pawDir, f), { force: true });
            }
          }
          for (const d of ['heartbeats', 'nudges', 'triage']) {
            const p = resolve(pawDir, d);
            if (existsSync(p)) rmSync(p, { recursive: true });
          }
        } catch {
          /* best-effort cleanup */
        }

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

        try {
          const doc = readDoc('templates', 'paw-yaml');
          if (doc) {
            const yamlMatch = doc.content.match(/```yaml\r?\n([\s\S]*?)```/);
            if (yamlMatch) {
              const configDir = resolve(repoRoot, '.paw');
              mkdirSync(configDir, { recursive: true });
              writeFileSync(resolve(configDir, 'paw.yaml'), yamlMatch[1]);
              success('config', 'reset .paw/paw.yaml to template');
            }
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
