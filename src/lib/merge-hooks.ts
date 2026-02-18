import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { readSyncFile } from './sync.js';
import { isMergeInProgress } from './git.js';

/**
 * Extract a conflict brief from the sync branch to .paw/tmp/conflict-brief.md.
 * Returns the absolute path to the extracted file, or null if the brief
 * doesn't exist on the sync branch.
 */
export function extractConflictBrief(taskName: string, repoRoot: string): string | null {
  const briefContent = readSyncFile(`conflicts/${taskName}-into-target.md`, repoRoot);
  if (briefContent === null) return null;

  const outPath = resolve(repoRoot, '.paw', 'tmp', 'conflict-brief.md');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, briefContent);

  return outPath;
}

/**
 * Run an auto-resolve hook command with environment variables.
 * Returns the exit code (0 on success, non-zero on failure).
 * Inherits stdio so the hook's output is visible to the orchestrator.
 */
export function runAutoResolveHook(
  command: string,
  cwd: string,
  env: Record<string, string>,
): number {
  try {
    execSync(command, {
      cwd,
      stdio: 'inherit',
      shell: 'bash',
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      return err.status;
    }
    return 1;
  }
}

interface ConflictResolveOpts {
  hookCommand: string;
  taskName: string;
  target: string;
  briefPath: string;
  cwd: string;
}

/**
 * Run the on-conflict hook once. Verify isMergeInProgress() is false afterward.
 * Returns true if the conflict was resolved, false otherwise.
 */
export function tryAutoResolveConflict(opts: ConflictResolveOpts): boolean {
  const { hookCommand, taskName, target, briefPath, cwd } = opts;

  runAutoResolveHook(hookCommand, cwd, {
    PAW_CONFLICT_TASK: taskName,
    PAW_CONFLICT_BRIEF: briefPath,
    PAW_TARGET: target,
  });

  return !isMergeInProgress(cwd);
}

interface HookFailureResolveOpts {
  hookCommand: string;
  taskName: string;
  target: string;
  postMergeHook: string;
  backupRef: string;
  cwd: string;
}

/**
 * Run the on-hook-failure hook once. Re-run post-merge to verify the fix.
 * Returns true if the post-merge hook passes, false otherwise.
 */
export function tryAutoResolveHookFailure(opts: HookFailureResolveOpts): boolean {
  const { hookCommand, taskName, target, postMergeHook, backupRef, cwd } = opts;

  const hookExit = runAutoResolveHook(hookCommand, cwd, {
    PAW_FAILED_TASK: taskName,
    PAW_HOOK_COMMAND: postMergeHook,
    PAW_BACKUP_REF: backupRef,
    PAW_TARGET: target,
  });

  if (hookExit !== 0) return false;

  console.log(pc.dim(`    Re-running post-merge hook: ${postMergeHook}`));
  const verifyExit = runAutoResolveHook(postMergeHook, cwd, {});
  return verifyExit === 0;
}
