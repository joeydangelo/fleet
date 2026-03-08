import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  initMergeState,
  updateMergeEntry,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendMessage } from '../src/lib/messages.js';
import { generateConflictBrief } from '../src/lib/conflict.js';
import {
  mergeBranch,
  isMergeInProgress,
  getMergeConflictDiff,
  getConflictingFiles,
} from '../src/lib/git.js';
import { createSession } from '../src/lib/session.js';
import { removeWorktree } from '../src/lib/git.js';
import type { PawConfig } from '../src/lib/config.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

function commitFile(dir: string, filename: string, content: string, message: string): void {
  writeFileSync(resolve(dir, filename), content);
  execFileSync('git', ['add', filename], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', message], {
    cwd: dir,
    stdio: 'pipe',
  });
}

function checkout(dir: string, branch: string): void {
  execFileSync('git', ['checkout', branch], { cwd: dir, stdio: 'pipe' });
}

describe('getMergeConflictDiff / getConflictingFiles', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    try {
      execFileSync('git', ['merge', '--abort'], {
        cwd: repoDir,
        stdio: 'pipe',
      });
    } catch {
      // No merge in progress
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns conflicting files during merge conflict', () => {
    execFileSync('git', ['checkout', '-b', 'branch-a'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'shared.txt', 'content-a', 'branch-a commit');

    checkout(repoDir, 'main');
    commitFile(repoDir, 'shared.txt', 'content-main', 'main commit');

    mergeBranch('branch-a', repoDir);

    const files = getConflictingFiles(repoDir);
    expect(files).toContain('shared.txt');

    const diff = getMergeConflictDiff(repoDir);
    expect(diff).toContain('shared.txt');
  });

  it('only shows conflicting files, not unrelated working tree changes', () => {
    // Create a tracked file and modify it (unrelated change)
    commitFile(repoDir, 'docs.md', 'original docs', 'add docs');

    execFileSync('git', ['checkout', '-b', 'branch-a'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'shared.txt', 'content-a', 'branch-a commit');

    checkout(repoDir, 'main');
    commitFile(repoDir, 'shared.txt', 'content-main', 'main commit');

    // Modify an unrelated tracked file (working tree change)
    writeFileSync(resolve(repoDir, 'docs.md'), 'modified docs');

    mergeBranch('branch-a', repoDir);

    const diff = getMergeConflictDiff(repoDir);
    expect(diff).toContain('shared.txt');
    expect(diff).not.toContain('docs.md');
  });
});

describe('generateConflictBrief', () => {
  let repoDir: string;
  let worktreePaths: string[];

  const config: PawConfig = {
    base: 'main',
    target: 'feature/dash',
    tasks: {
      auth: { focus: 'src/auth/' },
      api: { focus: 'src/api/' },
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
      execFileSync('git', ['merge', '--abort'], {
        cwd: repoDir,
        stdio: 'pipe',
      });
    } catch {
      // No merge in progress
    }

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

  it('generates brief with messages and diff', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Init sync state
    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };
    writeSyncState(withMerges, repoDir);

    // Write messages
    appendMessage('auth', { type: 'broadcast', msg: 'Changed auth interface' }, repoDir);
    appendMessage('api', { type: 'send', to: 'auth', msg: 'What token type?' }, repoDir);

    // Create conflicting changes
    checkout(repoDir, config.target);
    commitFile(repoDir, 'shared.txt', 'target-content', 'target commit');

    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'shared.txt', 'auth-content', 'auth commit');

    // Merge auth (conflicts with target)
    checkout(repoDir, config.target);
    const result = mergeBranch(authWt.branch, repoDir);
    expect(result.success).toBe(false);
    expect(isMergeInProgress(repoDir)).toBe(true);

    // Mark auth as conflict in state
    const conflictState = updateMergeEntry(withMerges, 'auth', {
      status: 'conflict',
    });

    // Generate the brief
    const brief = generateConflictBrief({
      conflictingTask: 'auth',
      target: config.target,
      state: conflictState,
      cwd: repoDir,
    });

    // Verify brief content — PR descriptions come from gh pr view (unavailable
    // in tests), so only check structural sections, messages, and diff.
    expect(brief).toContain('# Merge Conflict: auth into feature/dash');
    expect(brief).toContain('shared.txt');
    expect(brief).toContain('Task being merged: auth');
    expect(brief).toContain('Changed auth interface');
    expect(brief).toContain('What token type?');
  });

  it('conflict brief excludes unrelated working tree changes', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };
    writeSyncState(withMerges, repoDir);

    // Create a tracked file and then modify it (unrelated change)
    checkout(repoDir, config.target);
    commitFile(repoDir, 'docs.md', 'original docs', 'add docs');

    // Also create an untracked file
    writeFileSync(resolve(repoDir, 'local-notes.txt'), 'my notes');

    // Modify the tracked file
    writeFileSync(resolve(repoDir, 'docs.md'), 'modified docs');

    // Create conflicting changes
    commitFile(repoDir, 'shared.txt', 'target-content', 'target commit');

    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'shared.txt', 'auth-content', 'auth commit');

    // Merge auth (conflicts)
    checkout(repoDir, config.target);
    mergeBranch(authWt.branch, repoDir);

    const conflictState = updateMergeEntry(withMerges, 'auth', {
      status: 'conflict',
    });

    const brief = generateConflictBrief({
      conflictingTask: 'auth',
      target: config.target,
      state: conflictState,
      cwd: repoDir,
    });

    // Brief should contain the conflicting file but NOT the unrelated changes
    expect(brief).toContain('shared.txt');
    expect(brief).not.toContain('local-notes.txt');
    expect(brief).not.toContain('my notes');
  });

  it('includes already-merged task entries', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };
    writeSyncState(withMerges, repoDir);

    // Mark auth as already merged
    const authMerged = updateMergeEntry(withMerges, 'auth', {
      status: 'merged',
      merged: '2026-02-10T15:00:00Z',
    });

    // Make conflicting changes for api
    checkout(repoDir, config.target);
    commitFile(repoDir, 'shared.txt', 'target-content', 'target commit');

    const apiWt = worktrees.find((w) => w.taskName === 'api')!;
    commitFile(apiWt.worktreePath, 'shared.txt', 'api-content', 'api commit');

    checkout(repoDir, config.target);
    const result = mergeBranch(apiWt.branch, repoDir);
    expect(result.success).toBe(false);

    const conflictState = updateMergeEntry(authMerged, 'api', {
      status: 'conflict',
    });

    const brief = generateConflictBrief({
      conflictingTask: 'api',
      target: config.target,
      state: conflictState,
      cwd: repoDir,
    });

    expect(brief).toContain('# Merge Conflict: api into feature/dash');
    expect(brief).toContain('Already merged (in target)');
    expect(brief).toContain('auth -- merged clean at 2026-02-10T15:00:00Z');
  });
});
