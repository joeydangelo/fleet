import { Command } from 'commander';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import pc from 'picocolors';
import { loadRepoConfig } from '../lib/config.js';
import type { FleetConfig } from '../lib/config.js';
import { createSession, planWorktrees, writeTaskFiles, copyIncludes } from '../lib/session.js';
import type { WorktreeInfo } from '../lib/session.js';
import { initSyncState, writeSyncStateAndFiles, initSyncWorktree } from '../lib/sync.js';
import { installHooks } from '../lib/hooks.js';
import { success, pending, handleError } from '../lib/output.js';
import { emitEvent } from '../lib/feed.js';

/** Create worktrees, copy config, run hooks, and initialize sync state for all tasks. */
export async function runUp(
  repoRoot: string,
  configPath: string,
  config: FleetConfig,
  opts?: { quiet?: boolean },
): Promise<WorktreeInfo[]> {
  const quiet = opts?.quiet ?? false;
  const worktrees = createSession(config, repoRoot);
  writeTaskFiles(config, worktrees, config.target);

  const claudeDir = resolve(repoRoot, '.claude');
  if (existsSync(claudeDir)) {
    for (const wt of worktrees) {
      const dest = resolve(wt.worktreePath, '.claude');
      if (!existsSync(dest)) {
        cpSync(claudeDir, dest, { recursive: true });
        if (!quiet) success(wt.taskName, '.claude/ → worktree');
      }
    }
  }

  // Always install hooks in each worktree to ensure they're current
  // (the branch's .claude/ may be stale if hooks were added after the base branch)
  for (const wt of worktrees) {
    installHooks(wt.worktreePath, { quiet });
  }

  const specFile = config.spec;
  if (specFile) {
    const specPath = resolve(repoRoot, specFile);
    if (existsSync(specPath)) {
      for (const wt of worktrees) {
        const dest = resolve(wt.worktreePath, specFile);
        if (!existsSync(dest)) {
          mkdirSync(dirname(dest), { recursive: true });
          cpSync(specPath, dest);
        }
      }
    }
  }

  if (config.include?.length) {
    const results = await Promise.all(
      worktrees.map(async (wt) => ({
        wt,
        copied: await copyIncludes(repoRoot, wt.worktreePath, config.include!),
      })),
    );
    if (!quiet) {
      for (const { wt, copied } of results) {
        if (copied.length > 0) {
          console.log(
            pc.dim(`  copied ${copied.length} file(s) to ${wt.taskName}: ${copied.join(', ')}`),
          );
        }
      }
    }
  }

  const taskNames = Object.keys(config.tasks);
  initSyncWorktree(repoRoot);
  const focusMap: Record<string, string[]> = {};
  for (const [name, task] of Object.entries(config.tasks)) {
    focusMap[name] = Array.isArray(task.focus) ? task.focus : [task.focus];
  }
  const syncState = initSyncState(config.target, taskNames, configPath, focusMap);
  const syncFiles: Array<{ path: string; content: string }> = [
    { path: 'inbox/.gitkeep', content: '' },
  ];

  if (config.spec) {
    const specPath = resolve(repoRoot, config.spec);
    if (existsSync(specPath)) {
      const content = readFileSync(specPath, 'utf-8');
      syncFiles.push({ path: `specs/${basename(specPath)}`, content });
    }
  }

  writeSyncStateAndFiles(syncState, syncFiles, repoRoot);

  if (!quiet) {
    for (const wt of worktrees) {
      success(wt.taskName, wt.worktreePath);
    }
  }

  return worktrees;
}

/** CLI command: create worktrees and branches for all tasks in the session. */
export function upCommand(): Command {
  return new Command('up')
    .description('Create worktrees and branches for all tasks')
    .option('--dry-run', 'Show what would be created without making changes')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const { repoRoot, configPath, config } = loadRepoConfig();
        const taskNames = Object.keys(config.tasks);

        console.log(
          pc.bold(`fleet up: ${taskNames.length} tasks${opts.dryRun ? ' (dry run)' : ''}`),
        );
        console.log(`  base:   ${config.base}`);
        console.log(`  target: ${config.target}\n`);

        if (opts.dryRun) {
          const worktrees = planWorktrees(config, repoRoot);
          for (const wt of worktrees) {
            pending(wt.taskName, `${wt.branch} -> ${wt.worktreePath}`);
          }
          const claudeDirExists = existsSync(resolve(repoRoot, '.claude'));
          if (claudeDirExists) {
            console.log(pc.dim('\n  .claude/ will be copied into each worktree'));
          }
          if (config.include?.length) {
            console.log(pc.dim(`\n  include: ${config.include.join(', ')}`));
          }
          console.log(pc.dim('\nDry run -- no changes made.'));
          return;
        }

        await runUp(repoRoot, configPath, config);
        emitEvent({ event: 'fleet.up', target: config.target, tasks: taskNames.length });
        emitEvent({ event: 'session.start', target: config.target, tasks: taskNames.length });
        console.log(pc.dim('\nOpen an agent session in each worktree path to begin.'));
      } catch (err) {
        handleError(err);
      }
    });
}
