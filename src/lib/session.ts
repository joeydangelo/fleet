import { resolve, dirname, basename } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { PawConfig } from "./config.js";
import {
  branchExists,
  createBranch,
  createWorktree,
  getRepoRoot,
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
    branch: `${config.target}/${taskName}`,
    worktreePath: resolve(parentDir, `${repoName}-paw-${taskName}`),
  }));
}

export function createSession(
  config: PawConfig,
  repoRoot: string,
): WorktreeInfo[] {
  // Create target branch if it doesn't exist
  if (!branchExists(config.target, repoRoot)) {
    createBranch(config.target, config.base, repoRoot);
  }

  const worktrees = planWorktrees(config, repoRoot);

  for (const wt of worktrees) {
    // Create sub-branch from target
    if (!branchExists(wt.branch, repoRoot)) {
      createBranch(wt.branch, config.target, repoRoot);
    }

    // Create worktree
    createWorktree(wt.worktreePath, wt.branch, repoRoot);
  }

  return worktrees;
}

export function generateHandoff(
  config: PawConfig,
  taskName: string,
  worktreeInfo: WorktreeInfo,
): string {
  const task = config.tasks[taskName];
  if (!task) throw new Error(`Task not found: ${taskName}`);

  const focus = Array.isArray(task.focus)
    ? task.focus.join(", ")
    : task.focus;

  const lines: string[] = [
    `Task: ${taskName}`,
    ``,
    `Branch: ${worktreeInfo.branch} (from ${config.target})`,
    `Worktree: ${worktreeInfo.worktreePath}`,
    `Focus: ${focus}`,
  ];

  if (task.bead) {
    lines.push(`Bead: ${task.bead}`);
  }

  if (task.prompt) {
    lines.push(``, task.prompt);
  }

  return lines.join("\n");
}

export function writeHandoffs(
  config: PawConfig,
  worktrees: WorktreeInfo[],
  repoRoot: string,
): string {
  const outDir = resolve(repoRoot, ".paw");
  mkdirSync(outDir, { recursive: true });

  const handoffPath = resolve(outDir, "handoffs.md");
  const sections: string[] = ["# paw handoffs\n"];

  for (const wt of worktrees) {
    const handoff = generateHandoff(config, wt.taskName, wt);
    sections.push(`## ${wt.taskName}\n`);
    sections.push("```");
    sections.push(handoff);
    sections.push("```\n");
  }

  writeFileSync(handoffPath, sections.join("\n"), "utf-8");
  return handoffPath;
}
