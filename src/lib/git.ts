import { execFileSync } from "node:child_process";
import type { ExecFileSyncOptions } from "node:child_process";

export function git(args: string[], options?: ExecFileSyncOptions): string {
  const result = execFileSync("git", args, {
    ...options,
    encoding: "utf-8",
  });
  return result.trim();
}

export function getRepoRoot(cwd?: string): string {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

export function getCurrentBranch(cwd?: string): string {
  return git(["branch", "--show-current"], { cwd });
}

export function branchExists(branch: string, cwd?: string): boolean {
  try {
    git(["rev-parse", "--verify", branch], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function createBranch(branch: string, from: string, cwd?: string): void {
  git(["branch", branch, from], { cwd });
}

export function createWorktree(
  path: string,
  branch: string,
  cwd?: string,
): void {
  git(["worktree", "add", path, branch], { cwd });
}

export function removeWorktree(path: string, cwd?: string): void {
  git(["worktree", "remove", "--force", path], { cwd });
}

export function listWorktrees(
  cwd?: string,
): Array<{ path: string; branch: string }> {
  const output = git(["worktree", "list", "--porcelain"], { cwd });
  const worktrees: Array<{ path: string; branch: string }> = [];
  let currentPath = "";

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const branch = line.slice("branch refs/heads/".length);
      worktrees.push({ path: currentPath, branch });
    }
  }

  return worktrees;
}

export function getCommitCount(
  branch: string,
  base: string,
  cwd?: string,
): number {
  const output = git(["rev-list", "--count", `${base}..${branch}`], {
    cwd,
    stdio: "pipe",
  });
  return parseInt(output, 10);
}

export function getChangedFileCount(
  branch: string,
  base: string,
  cwd?: string,
): number {
  const output = git(["diff", "--name-only", base, branch], {
    cwd,
    stdio: "pipe",
  });
  if (!output) return 0;
  return output.split("\n").length;
}

export function mergeBranch(
  branch: string,
  cwd?: string,
): { success: boolean; message: string } {
  try {
    const output = git(["merge", branch, "--no-edit"], { cwd });
    return { success: true, message: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

/** Delete a local branch. */
export function deleteBranch(branch: string, cwd?: string): void {
  git(["branch", "-D", branch], { cwd, stdio: "pipe" });
}

/** Get diff output for a merge conflict (shows conflict markers). */
export function getDiffOutput(cwd?: string): string {
  try {
    return git(["diff"], { cwd, stdio: "pipe" });
  } catch {
    return "";
  }
}

/** Get the list of conflicting files during a merge. */
export function getConflictingFiles(cwd?: string): string[] {
  try {
    const output = git(["diff", "--name-only", "--diff-filter=U"], {
      cwd,
      stdio: "pipe",
    });
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Check whether git is currently in a merge-conflict state (MERGE_HEAD exists). */
export function isMergeInProgress(cwd?: string): boolean {
  try {
    git(["rev-parse", "--verify", "MERGE_HEAD"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
