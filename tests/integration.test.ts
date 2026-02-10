import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createSession, writeTaskFiles } from "../src/lib/session.js";
import { initSyncState, writeSyncState, readSyncState } from "../src/lib/sync.js";
import { branchExists, listWorktrees, removeWorktree } from "../src/lib/git.js";
import type { PawConfig } from "../src/lib/config.js";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", dir], { stdio: "pipe" });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: dir,
    stdio: "pipe",
  });
}

describe("paw session lifecycle", () => {
  let repoDir: string;
  let worktreePaths: string[];

  const config: PawConfig = {
    base: "main",
    target: "feature/dash",
    tasks: {
      auth: { focus: "src/auth/", prompt: "Implement auth." },
      api: { focus: ["src/api/", "src/routes/"] },
    },
  };

  beforeEach(() => {
    repoDir = makeTempDir();
    worktreePaths = [];
    gitInit(repoDir);
  });

  afterEach(() => {
    for (const p of worktreePaths) {
      if (existsSync(p)) {
        try {
          removeWorktree(p, repoDir);
        } catch {
          // force cleanup if git worktree remove fails
          rmSync(p, { recursive: true, force: true });
        }
      }
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("creates target and task branches", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    expect(branchExists("feature/dash", repoDir)).toBe(true);
    expect(branchExists("feature/dash-auth", repoDir)).toBe(true);
    expect(branchExists("feature/dash-api", repoDir)).toBe(true);
  });

  it("creates worktrees as sibling directories", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    for (const wt of worktrees) {
      expect(existsSync(wt.worktreePath)).toBe(true);
    }

    const listed = listWorktrees(repoDir);
    const branches = listed.map((w) => w.branch);
    expect(branches).toContain("feature/dash-auth");
    expect(branches).toContain("feature/dash-api");
  });

  it("writes task files into worktrees", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    writeTaskFiles(config, worktrees);

    for (const wt of worktrees) {
      const taskFile = resolve(wt.worktreePath, ".paw", "tasks", `${wt.taskName}.md`);
      expect(existsSync(taskFile)).toBe(true);

      const content = readFileSync(taskFile, "utf-8");
      expect(content).toContain(`# Task: ${wt.taskName}`);
      expect(content).toContain(`**Branch:** ${wt.branch}`);
    }
  });

  it("adds .paw/ to .gitignore in each worktree", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    writeTaskFiles(config, worktrees);

    for (const wt of worktrees) {
      const gitignore = resolve(wt.worktreePath, ".gitignore");
      expect(existsSync(gitignore)).toBe(true);

      const content = readFileSync(gitignore, "utf-8");
      expect(content).toContain(".paw/");
    }
  });

  it("initializes sync branch with pending tasks", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const taskNames = Object.keys(config.tasks);
    const syncState = initSyncState(config.target, taskNames, "paw.yaml");
    writeSyncState(syncState, repoDir);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.target).toBe("feature/dash");
    expect(Object.keys(read!.tasks)).toEqual(["auth", "api"]);
    expect(read!.tasks["auth"]?.status).toBe("pending");
    expect(read!.tasks["api"]?.status).toBe("pending");
  });

  it("tears down worktrees cleanly", () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    for (const wt of worktrees) {
      removeWorktree(wt.worktreePath, repoDir);
    }

    for (const wt of worktrees) {
      expect(existsSync(wt.worktreePath)).toBe(false);
    }

    // Clear tracked paths since we already cleaned up
    worktreePaths = [];
  });
});
