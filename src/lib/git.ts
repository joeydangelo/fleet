import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { toErrorMessage } from './output.js';

/** Runs a git command synchronously. Strips trailing whitespace and throws on non-zero exit. */
export function git(args: string[], options?: ExecFileSyncOptions): string {
  const result = execFileSync('git', args, {
    ...options,
    encoding: 'utf-8',
  });
  const trimmed = result.trim();
  if (process.env.SHOW_COMMANDS === '1') {
    console.error(
      `[git] git ${args.join(' ')} → ${trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed}`,
    );
  }
  return trimmed;
}

/** Resolve the root of the git repository containing `cwd`. */
export function getRepoRoot(cwd?: string): string {
  return git(['rev-parse', '--show-toplevel'], { cwd });
}

/** Like getRepoRoot but returns null instead of throwing when not in a git repo. */
export function getRepoRootOrNull(cwd?: string): string | null {
  try {
    return getRepoRoot(cwd);
  } catch {
    return null;
  }
}

/**
 * Resolve the main repo root from any worktree. Uses git-common-dir to find
 * the shared .git directory, then goes up one level. Returns the same path
 * as getRepoRoot() when called from the main worktree.
 */
export function resolveMainRoot(cwd?: string): string {
  const dir = cwd ?? process.cwd();
  const gitCommonDir = git(['rev-parse', '--git-common-dir'], { cwd: dir, stdio: 'pipe' });
  return resolve(dir, gitCommonDir, '..');
}

/** Returns the current branch name, or empty string if HEAD is detached. */
export function getCurrentBranch(cwd?: string): string {
  return git(['branch', '--show-current'], { cwd });
}

/** Check whether a local branch or ref exists. */
export function branchExists(branch: string, cwd?: string): boolean {
  try {
    git(['rev-parse', '--verify', branch], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Create a new local branch pointing at `from`. */
export function createBranch(branch: string, from: string, cwd?: string): void {
  git(['branch', branch, from], { cwd });
}

/** Create a git worktree at `worktreePath` checked out to `branch`. */
export function createWorktree(worktreePath: string, branch: string, cwd?: string): void {
  git(['worktree', 'add', worktreePath, branch], { cwd });
}

/** Falls back to `rmSync` + prune when `git worktree remove` fails (common on Windows). */
export function removeWorktree(worktreePath: string, cwd?: string): void {
  try {
    git(['worktree', 'remove', '--force', worktreePath], { cwd });
  } catch {
    rmSync(worktreePath, { recursive: true, force: true });
    git(['worktree', 'prune'], { cwd });
  }
}

/** Count commits on `branch` that are not reachable from `base`. */
export function getCommitCount(branch: string, base: string, cwd?: string): number {
  const output = git(['rev-list', '--count', `${base}..${branch}`], {
    cwd,
    stdio: 'pipe',
  });
  return parseInt(output, 10);
}

/** Count files changed between `base` and `branch`. */
export function getChangedFileCount(branch: string, base: string, cwd?: string): number {
  const output = git(['diff', '--name-only', base, branch], {
    cwd,
    stdio: 'pipe',
  });
  if (!output) return 0;
  return output.split('\n').length;
}

/** Attempt a no-edit merge of `branch` into HEAD. Returns success status and git output. */
export function mergeBranch(branch: string, cwd?: string): { success: boolean; message: string } {
  try {
    const output = git(['merge', branch, '--no-edit'], { cwd });
    return { success: true, message: output };
  } catch (error) {
    return { success: false, message: toErrorMessage(error) };
  }
}

/** Force-delete a local branch (`-D`). */
export function deleteBranch(branch: string, cwd?: string): void {
  git(['branch', '-D', branch], { cwd, stdio: 'pipe' });
}

/** Returns the diff for unmerged (conflicting) files only during an active merge. */
export function getMergeConflictDiff(cwd?: string): string {
  try {
    return git(['diff', '--diff-filter=U'], { cwd, stdio: 'pipe' });
  } catch {
    return '';
  }
}

/** List files with unresolved merge conflicts (diff filter=U). */
export function getConflictingFiles(cwd?: string): string[] {
  try {
    const output = git(['diff', '--name-only', '--diff-filter=U'], {
      cwd,
      stdio: 'pipe',
    });
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Return the full SHA of the current HEAD commit. */
export function getHeadRef(cwd?: string): string {
  return git(['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' });
}

/** Create a backup ref at refs/paw-backup/{taskName} pointing to the given commit. */
export function createBackupRef(taskName: string, commit: string, cwd?: string): void {
  git(['update-ref', `refs/paw-backup/${taskName}`, commit], { cwd });
}

/** Remove all `refs/paw-backup/*` refs created during merge. Best-effort. */
export function cleanupBackupRefs(cwd?: string): void {
  try {
    const output = git(['for-each-ref', '--format=%(refname)', 'refs/paw-backup/'], {
      cwd,
      stdio: 'pipe',
    });
    if (!output) return;
    for (const ref of output.split('\n').filter(Boolean)) {
      git(['update-ref', '-d', ref], { cwd });
    }
  } catch {
    /* empty — no refs to clean */
  }
}

/** Stash all working tree changes (staged, unstaged, untracked). Returns true if anything was stashed. */
export function stashWorkingTree(cwd: string): boolean {
  const status = git(['status', '--porcelain'], { cwd, stdio: 'pipe' });
  if (!status) return false;
  git(['stash', 'push', '--include-untracked', '-m', 'paw: pre-merge stash'], { cwd });
  return true;
}

/** Pop the most recent stash entry. Returns false if pop fails (e.g. during active merge conflict). */
export function unstashWorkingTree(cwd: string): boolean {
  try {
    git(['stash', 'pop'], { cwd });
    return true;
  } catch {
    return false;
  }
}

/** Check if commit is an ancestor of target (i.e., target contains all commits from commit). */
export function isAncestor(commit: string, target: string, cwd?: string): boolean {
  try {
    git(['merge-base', '--is-ancestor', commit, target], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Read a file from a specific branch. Returns null if the file doesn't exist on that branch. */
export function getFileFromBranch(branch: string, filepath: string, cwd?: string): string | null {
  try {
    return git(['show', `${branch}:${filepath}`], { cwd, stdio: 'pipe' });
  } catch {
    return null;
  }
}

/** Checks for MERGE_HEAD to detect an in-progress merge. */
export function isMergeInProgress(cwd?: string): boolean {
  try {
    git(['rev-parse', '--verify', 'MERGE_HEAD'], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
