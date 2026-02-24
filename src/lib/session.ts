import { resolve, dirname, basename } from 'node:path';
import { mkdirSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { execSync } from 'node:child_process';
import fg from 'fast-glob';
import type { PawConfig } from './config.js';
import { normalizeDeps } from './config.js';
import { branchExists, createBranch, createWorktree, getFileFromBranch } from './git.js';
import { REQUIRED_SECTIONS } from './summary.js';

/** Identity triple for a task worktree: task name, its branch, and the filesystem path. */
export interface WorktreeInfo {
  taskName: string;
  branch: string;
  worktreePath: string;
}

export function planWorktrees(config: PawConfig, repoRoot: string): WorktreeInfo[] {
  const repoName = basename(repoRoot);
  const parentDir = dirname(repoRoot);

  return Object.keys(config.tasks).map((taskName) => ({
    taskName,
    branch: `${config.target}-${taskName}`,
    worktreePath: resolve(parentDir, `${repoName}-paw-${taskName}`),
  }));
}

/** Creates the target branch (if needed), per-task branches, and their worktrees. */
export function createSession(config: PawConfig, repoRoot: string): WorktreeInfo[] {
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

const COLLABORATION_RULES = `## Collaboration Rules

- Run \`paw broadcast "..."\` when you make significant changes, especially
  interface changes that affect other agents.
- Run \`paw threads\` to see open Q&A threads and answer directed questions.
- Stay within your focus areas. If you need to modify files outside your
  focus, broadcast first.
- Do NOT run \`git push\`. The orchestrator pushes the merged target branch
  after \`paw merge\`. Pushing from a worktree bypasses conflict resolution.`;

const SECTION_DESCRIPTIONS: Record<string, string> = {
  'What I did': '- Bullet list of what you built or changed',
  'Interface changes':
    '- New exports, changed signatures, renamed types\n- Anything another agent importing from your files needs to know',
  'Watch out': '- Breaking changes, migration needs, gotchas\n- Files other agents should check',
};

const SUMMARY_TEMPLATE = [
  `## When You're Done`,
  ``,
  `Run \`paw done --summary "..."\` with a structured summary. Use this format:`,
  ``,
  ...REQUIRED_SECTIONS.flatMap((s) => [`### ${s}`, SECTION_DESCRIPTIONS[s] ?? '- [Details]', ``]),
  `This summary feeds the conflict brief. Be specific about interface changes --`,
  `other agents depend on this information to resolve merge conflicts.`,
].join('\n');

export function generateTaskFile(config: PawConfig, worktreeInfo: WorktreeInfo): string {
  const { taskName } = worktreeInfo;
  const task = config.tasks[taskName];
  if (!task) throw new Error(`Task not found: ${taskName}`);

  const focusList = Array.isArray(task.focus) ? task.focus : [task.focus];

  const lines: string[] = [
    `# Task: ${taskName}`,
    ``,
    `**Branch:** ${worktreeInfo.branch}`,
    `**Target:** ${config.target}`,
    `**Worktree:** ${worktreeInfo.worktreePath}`,
    ...(task.issue ? [`**Issue:** ${task.issue}`] : []),
    ...(task.spec ? [`**Spec:** ${task.spec}`] : []),
    ...(task.depends_on ? [`**Depends on:** ${normalizeDeps(task.depends_on).join(', ')}`] : []),
    ``,
    `## Focus`,
    ``,
    ...focusList.map((f) => `- ${f}`),
  ];

  if (task.prompt) {
    lines.push(``, `## Instructions`, ``, task.prompt.trimEnd());
  }

  lines.push(``, COLLABORATION_RULES, ``, SUMMARY_TEMPLATE);

  return lines.join('\n') + '\n';
}

/** Adds `.paw/` to .gitignore unless the base branch already has it, avoiding duplicate entries that cause merge conflicts. */
export function ensureGitignore(worktreePath: string, baseBranch?: string): void {
  const gitignorePath = resolve(worktreePath, '.gitignore');
  const entry = '.paw/';

  // If the base branch already has this entry, the worktree inherited it -- skip
  // to avoid duplicate additions across branches that cause merge conflicts (paw-numd).
  if (baseBranch) {
    const baseContent = getFileFromBranch(baseBranch, '.gitignore', worktreePath);
    if (baseContent && baseContent.split('\n').some((line) => line.trim() === entry)) {
      return;
    }
  }

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (content.split('\n').some((line) => line.trim() === entry)) return;
    writeFileSync(gitignorePath, content.trimEnd() + '\n' + entry + '\n');
  } else {
    writeFileSync(gitignorePath, entry + '\n');
  }
}

/**
 * Detect which task this directory belongs to by checking .paw/tasks/ for a
 * single task file. Returns null if detection fails.
 */
export function detectTaskName(cwd: string): string | null {
  const tasksDir = resolve(cwd, '.paw', 'tasks');
  if (existsSync(tasksDir)) {
    const files = readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
    if (files.length === 1) {
      return files[0]!.replace(/\.md$/, '');
    }
  }
  return null;
}

/** Detect task name or fall back to 'orchestrator' for the main repo. */
export function getTaskIdentity(cwd: string): string {
  return detectTaskName(cwd) ?? 'orchestrator';
}

/**
 * Copy files matching glob patterns from repo root into a worktree.
 * Skips files that already exist in the worktree (e.g. tracked files).
 * Returns the list of relative paths that were actually copied.
 */
export async function copyIncludes(
  repoRoot: string,
  worktreePath: string,
  patterns: string[],
): Promise<string[]> {
  const matches = await fg(patterns, { cwd: repoRoot, dot: true, onlyFiles: true });
  const copied: string[] = [];

  for (const file of matches) {
    const dest = resolve(worktreePath, file);
    if (existsSync(dest)) continue;

    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolve(repoRoot, file), dest);
    copied.push(file);
  }

  return copied;
}

export function writeTaskFiles(
  config: PawConfig,
  worktrees: WorktreeInfo[],
  baseBranch?: string,
): void {
  for (const wt of worktrees) {
    const taskDir = resolve(wt.worktreePath, '.paw', 'tasks');
    mkdirSync(taskDir, { recursive: true });

    const taskFilePath = resolve(taskDir, `${wt.taskName}.md`);
    const content = generateTaskFile(config, wt);
    writeFileSync(taskFilePath, content, 'utf-8');

    ensureGitignore(wt.worktreePath, baseBranch);
  }
}

/** Run a hook command in a worktree directory. Throws on non-zero exit. */
export function runHook(worktreePath: string, command: string): void {
  execSync(command, { cwd: worktreePath, stdio: 'inherit', shell: 'bash' });
}
