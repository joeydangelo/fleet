import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptions } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

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

export function getRepoRoot(cwd?: string): string {
  return git(['rev-parse', '--show-toplevel'], { cwd });
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

export function getCurrentBranch(cwd?: string): string {
  return git(['branch', '--show-current'], { cwd });
}

export function branchExists(branch: string, cwd?: string): boolean {
  try {
    git(['rev-parse', '--verify', branch], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function createBranch(branch: string, from: string, cwd?: string): void {
  git(['branch', branch, from], { cwd });
}

export function createWorktree(path: string, branch: string, cwd?: string): void {
  git(['worktree', 'add', path, branch], { cwd });
}

/** Falls back to `rmSync` + prune when `git worktree remove` fails (common on Windows). */
export function removeWorktree(path: string, cwd?: string): void {
  try {
    git(['worktree', 'remove', '--force', path], { cwd });
  } catch {
    // Fallback: manually remove directory and prune worktree list.
    // git worktree remove can fail on Windows due to permission/symlink issues.
    rmSync(path, { recursive: true, force: true });
    git(['worktree', 'prune'], { cwd });
  }
}

export function getCommitCount(branch: string, base: string, cwd?: string): number {
  const output = git(['rev-list', '--count', `${base}..${branch}`], {
    cwd,
    stdio: 'pipe',
  });
  return parseInt(output, 10);
}

export function getChangedFileCount(branch: string, base: string, cwd?: string): number {
  const output = git(['diff', '--name-only', base, branch], {
    cwd,
    stdio: 'pipe',
  });
  if (!output) return 0;
  return output.split('\n').length;
}

export function mergeBranch(branch: string, cwd?: string): { success: boolean; message: string } {
  try {
    const output = git(['merge', branch, '--no-edit'], { cwd });
    return { success: true, message: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

export function deleteBranch(branch: string, cwd?: string): void {
  git(['branch', '-D', branch], { cwd, stdio: 'pipe' });
}

/** Returns the raw diff, which includes conflict markers during an in-progress merge. */
export function getDiffOutput(cwd?: string): string {
  try {
    return git(['diff'], { cwd, stdio: 'pipe' });
  } catch {
    return '';
  }
}

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

export function getHeadRef(cwd?: string): string {
  return git(['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' });
}

/** Create a backup ref at refs/paw-backup/{taskName} pointing to the given commit. */
export function createBackupRef(taskName: string, commit: string, cwd?: string): void {
  git(['update-ref', `refs/paw-backup/${taskName}`, commit], { cwd });
}

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
    // No backup refs to clean up
  }
}

/** Stage and commit untracked files. Returns true if files were committed, false if none existed. */
export function commitUntrackedFiles(cwd: string, taskName: string): boolean {
  const output = git(['ls-files', '--others', '--exclude-standard'], { cwd, stdio: 'pipe' });
  if (!output) return false;

  const files = output.split('\n').filter(Boolean);
  if (files.length === 0) return false;

  git(['add', ...files], { cwd });
  git(['commit', '-m', `paw: stage untracked files for merge of ${taskName}`], { cwd });
  return true;
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

/** Close the GitHub PR associated with a branch. Best-effort — returns false on failure. */
export function closePrForBranch(branch: string, comment: string, cwd?: string): boolean {
  try {
    execFileSync('gh', ['pr', 'close', branch, '--comment', comment], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15_000,
    });
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
