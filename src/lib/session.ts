import { resolve, dirname, basename } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { PawConfig } from "./config.js";
import {
  branchExists,
  createBranch,
  createWorktree,
} from "./git.js";

export interface WorktreeInfo {
  taskName: string;
  branch: string;
  worktreePath: string;
}

export function planWorktrees(
  config: PawConfig,
  repoRoot: string,
): WorktreeInfo[] {
  const repoName = basename(repoRoot);
  const parentDir = dirname(repoRoot);

  return Object.keys(config.tasks).map((taskName) => ({
    taskName,
    branch: `${config.target}-${taskName}`,
    worktreePath: resolve(parentDir, `${repoName}-paw-${taskName}`),
  }));
}

export function createSession(
  config: PawConfig,
  repoRoot: string,
): WorktreeInfo[] {
  if (!branchExists(config.target, repoRoot)) {
    createBranch(config.target, config.base, repoRoot);
  }

  const worktrees = planWorktrees(config, repoRoot);

  for (const wt of worktrees) {
    if (!branchExists(wt.branch, repoRoot)) {
      createBranch(wt.branch, config.target, repoRoot);
    }
    createWorktree(wt.worktreePath, wt.branch, repoRoot);
  }

  return worktrees;
}

export function generateTaskFile(
  config: PawConfig,
  taskName: string,
  worktreeInfo: WorktreeInfo,
): string {
  const task = config.tasks[taskName];
  if (!task) throw new Error(`Task not found: ${taskName}`);

  const focusList = Array.isArray(task.focus) ? task.focus : [task.focus];

  const lines: string[] = [
    `# Task: ${taskName}`,
    ``,
    `**Branch:** ${worktreeInfo.branch}`,
    `**Target:** ${config.target}`,
    `**Worktree:** ${worktreeInfo.worktreePath}`,
    ``,
    `## Focus`,
    ``,
    ...focusList.map((f) => `- ${f}`),
  ];

  if (task.prompt) {
    lines.push(``, `## Instructions`, ``, task.prompt.trimEnd());
  }

  return lines.join("\n") + "\n";
}

export function ensureGitignore(worktreePath: string): void {
  const gitignorePath = resolve(worktreePath, ".gitignore");
  const entry = ".paw/";

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some((line) => line.trim() === entry)) return;
    writeFileSync(gitignorePath, content.trimEnd() + "\n" + entry + "\n");
  } else {
    writeFileSync(gitignorePath, entry + "\n");
  }
}

export function writeTaskFiles(
  config: PawConfig,
  worktrees: WorktreeInfo[],
): void {
  for (const wt of worktrees) {
    const taskDir = resolve(wt.worktreePath, ".paw", "tasks");
    mkdirSync(taskDir, { recursive: true });

    const taskFilePath = resolve(taskDir, `${wt.taskName}.md`);
    const content = generateTaskFile(config, wt.taskName, wt);
    writeFileSync(taskFilePath, content, "utf-8");

    ensureGitignore(wt.worktreePath);
  }
}
