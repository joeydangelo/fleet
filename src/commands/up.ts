import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { createSession, planWorktrees, writeTaskFiles, copyIncludes } from '../lib/session.js';
import { initSyncState, writeSyncStateAndFiles, initSyncWorktree } from '../lib/sync.js';
import { success, pending, handleError } from '../lib/output.js';

export function upCommand(): Command {
  return new Command('up')
    .description('Create worktrees and branches for all tasks')
    .option('-c, --config <path>', 'Path to paw.yaml')
    .option('--dry-run', 'Show what would be created without making changes')
    .action(async (opts: { config?: string; dryRun?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);
        const taskNames = Object.keys(config.tasks);

        console.log(pc.bold(`paw up: ${taskNames.length} tasks${opts.dryRun ? ' (dry run)' : ''}`));
        console.log(`  base:   ${config.base}`);
        console.log(`  target: ${config.target}\n`);

        if (opts.dryRun) {
          const worktrees = planWorktrees(config, repoRoot);
          for (const wt of worktrees) {
            pending(wt.taskName, `${wt.branch} -> ${wt.worktreePath}`);
          }
          if (config.include?.length) {
            console.log(pc.dim(`\n  include: ${config.include.join(', ')}`));
          }
          console.log(pc.dim('\nDry run -- no changes made.'));
          return;
        }

        const worktrees = createSession(config, repoRoot);
        writeTaskFiles(config, worktrees, config.target);

        if (config.include?.length) {
          for (const wt of worktrees) {
            const copied = await copyIncludes(repoRoot, wt.worktreePath, config.include);
            if (copied.length > 0) {
              console.log(
                pc.dim(`  copied ${copied.length} file(s) to ${wt.taskName}: ${copied.join(', ')}`),
              );
            }
          }
        }

        initSyncWorktree(repoRoot);
        const focusMap: Record<string, string[]> = {};
        for (const [name, task] of Object.entries(config.tasks)) {
          focusMap[name] = Array.isArray(task.focus) ? task.focus : [task.focus];
        }
        const syncState = initSyncState(config.target, taskNames, configPath, focusMap);
        writeSyncStateAndFiles(syncState, [{ path: 'journal/.gitkeep', content: '' }], repoRoot);

        for (const wt of worktrees) {
          success(wt.taskName, wt.worktreePath);
        }

        console.log(pc.dim('\nOpen an agent session in each worktree path to begin.'));
      } catch (err) {
        handleError(err);
      }
    });
}
