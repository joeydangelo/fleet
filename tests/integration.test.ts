import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSession, writeTaskFiles, planWorktrees } from '../src/lib/session.js';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { branchExists, removeWorktree, deleteBranch } from '../src/lib/git.js';
import { writeSyncStateAndFiles } from '../src/lib/sync.js';
import type { PawConfig } from '../src/lib/config.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('paw session lifecycle', () => {
  let repoDir: string;
  let worktreePaths: string[];

  const config: PawConfig = {
    base: 'main',
    target: 'feature/dash',
    tasks: {
      auth: { focus: 'src/auth/', prompt: 'Implement auth.' },
      api: { focus: ['src/api/', 'src/routes/'] },
    },
  };

  beforeEach(() => {
    repoDir = makeTempDir();
    worktreePaths = [];
    gitInit(repoDir);
    initSyncWorktree(repoDir);
  });

  afterEach(() => {
    try {
      removeSyncWorktree(repoDir);
    } catch {
      // already removed
    }

    for (const p of worktreePaths) {
      if (existsSync(p)) {
        try {
          removeWorktree(p, repoDir);
        } catch {
          rmSync(p, { recursive: true, force: true });
        }
      }
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates target and task branches', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    expect(branchExists('feature/dash', repoDir)).toBe(true);
    expect(branchExists('feature/dash-auth', repoDir)).toBe(true);
    expect(branchExists('feature/dash-api', repoDir)).toBe(true);
  });

  it('creates worktrees as sibling directories', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    for (const wt of worktrees) {
      expect(existsSync(wt.worktreePath)).toBe(true);
    }

    expect(branchExists('feature/dash-auth', repoDir)).toBe(true);
    expect(branchExists('feature/dash-api', repoDir)).toBe(true);
  });

  it('writes task files into worktrees', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    writeTaskFiles(config, worktrees);

    for (const wt of worktrees) {
      const taskFile = resolve(wt.worktreePath, '.paw', 'tasks', `${wt.taskName}.md`);
      expect(existsSync(taskFile)).toBe(true);

      const content = readFileSync(taskFile, 'utf-8');
      expect(content).toContain(`# Task: ${wt.taskName}`);
      expect(content).toContain(`**Branch:** ${wt.branch}`);
    }
  });

  it('adds .paw/ to .gitignore in each worktree', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    writeTaskFiles(config, worktrees);

    for (const wt of worktrees) {
      const gitignore = resolve(wt.worktreePath, '.gitignore');
      expect(existsSync(gitignore)).toBe(true);

      const content = readFileSync(gitignore, 'utf-8');
      expect(content).toContain('.paw/');
    }
  });

  it('initializes sync branch with pending tasks', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const taskNames = Object.keys(config.tasks);
    const syncState = initSyncState(config.target, taskNames, 'paw.yaml');
    writeSyncState(syncState, repoDir);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.target).toBe('feature/dash');
    expect(Object.keys(read!.tasks)).toEqual(['auth', 'api']);
    expect(read!.tasks['auth']?.status).toBe('pending');
    expect(read!.tasks['api']?.status).toBe('pending');
  });

  it('planWorktrees (dry-run path) does not create branches or worktrees', () => {
    const worktrees = planWorktrees(config, repoDir);

    // planWorktrees is pure -- no side effects
    for (const wt of worktrees) {
      expect(existsSync(wt.worktreePath)).toBe(false);
    }
    expect(branchExists('feature/dash', repoDir)).toBe(false);
    expect(branchExists('feature/dash-auth', repoDir)).toBe(false);
  });

  it('tears down worktrees cleanly', () => {
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

  it('deletes sync branch on teardown', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const taskNames = Object.keys(config.tasks);
    const syncState = initSyncState(config.target, taskNames, 'paw.yaml');
    writeSyncStateAndFiles(syncState, [{ path: 'journal/.gitkeep', content: '' }], repoDir);

    expect(branchExists('paw-sync', repoDir)).toBe(true);

    // Tear down (as paw down does): worktrees first, then sync worktree, then branch
    for (const wt of worktrees) {
      removeWorktree(wt.worktreePath, repoDir);
    }
    removeSyncWorktree(repoDir);
    deleteBranch('paw-sync', repoDir);
    expect(branchExists('paw-sync', repoDir)).toBe(false);

    // Verify paw up works again after full teardown
    initSyncWorktree(repoDir);
    const worktrees2 = createSession(config, repoDir);
    const syncState2 = initSyncState(config.target, taskNames, 'paw.yaml');
    writeSyncStateAndFiles(syncState2, [{ path: 'journal/.gitkeep', content: '' }], repoDir);

    expect(branchExists('paw-sync', repoDir)).toBe(true);
    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.tasks['auth']?.status).toBe('pending');

    // Clean up second session
    for (const wt of worktrees2) {
      removeWorktree(wt.worktreePath, repoDir);
    }
    worktreePaths = [];
  });

  it('copies .claude/ into each worktree when present', () => {
    // Create a .claude directory with a settings file
    const claudeDir = resolve(repoDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(resolve(claudeDir, 'settings.json'), '{"hooks":{}}', 'utf-8');

    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Simulate what paw up does: copy .claude/ into each worktree
    for (const wt of worktrees) {
      const dest = resolve(wt.worktreePath, '.claude');
      if (!existsSync(dest)) {
        cpSync(claudeDir, dest, { recursive: true });
      }
    }

    for (const wt of worktrees) {
      const dest = resolve(wt.worktreePath, '.claude', 'settings.json');
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, 'utf-8')).toBe('{"hooks":{}}');
    }
  });
});
