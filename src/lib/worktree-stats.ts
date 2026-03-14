import { getCommitCount, getChangedFileCount } from './git.js';

/** Computes commit and changed-file counts for a branch relative to a target. Files is 0 when commits is 0. */
export function getWorktreeProgress(
  branch: string,
  target: string,
  repoRoot: string,
): { commits: number; files: number } {
  const commits = getCommitCount(branch, target, repoRoot);
  return { commits, files: commits > 0 ? getChangedFileCount(branch, target, repoRoot) : 0 };
}
