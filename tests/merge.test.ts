import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  initMergeState,
  updateMergeEntry,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import {
  isMergeInProgress,
  mergeBranch,
  git,
  isAncestor,
  stashWorkingTree,
  unstashWorkingTree,
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

describe('updateMergeEntry', () => {
  it("updates a single task's merge status", () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };

    const updated = updateMergeEntry(withMerges, 'auth', {
      status: 'merged',
      merged: '2026-02-10T15:00:00Z',
    });

    expect(updated.merges?.['auth']?.status).toBe('merged');
    expect(updated.merges?.['auth']?.merged).toBe('2026-02-10T15:00:00Z');
    expect(updated.merges?.['api']?.status).toBe('pending');
  });
});

describe('merge state round-trip through sync branch', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('persists merge state in sync branch', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };
    writeSyncState(withMerges, repoDir);

    const read = readSyncState(repoDir);
    expect(read?.merges).toBeDefined();
    expect(read?.merges?.['auth']?.status).toBe('pending');
    expect(read?.merges?.['api']?.status).toBe('pending');
  });

  it('updates merge state across writes', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };
    writeSyncState(withMerges, repoDir);

    const updated = updateMergeEntry(withMerges, 'auth', {
      status: 'merged',
      merged: '2026-02-10T15:00:00Z',
    });
    writeSyncState(updated, repoDir);

    const read = readSyncState(repoDir);
    expect(read?.merges?.['auth']?.status).toBe('merged');
    expect(read?.merges?.['api']?.status).toBe('pending');
  });
});

describe('isMergeInProgress', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns false when no merge is in progress', () => {
    expect(isMergeInProgress(repoDir)).toBe(false);
  });

  it('returns true during a conflict', () => {
    // Create a conflict scenario
    execFileSync('git', ['checkout', '-b', 'branch-a'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'conflict.txt', 'content-a', 'branch-a commit');

    execFileSync('git', ['checkout', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'conflict.txt', 'content-main', 'main commit');

    // Attempt merge -- will conflict
    mergeBranch('branch-a', repoDir);

    expect(isMergeInProgress(repoDir)).toBe(true);

    // Abort the merge to clean up
    execFileSync('git', ['merge', '--abort'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
  });
});

describe('merge stops on first conflict', () => {
  let repoDir: string;
  let worktreePaths: string[];

  const config: PawConfig = {
    base: 'main',
    target: 'feature/dash',
    tasks: {
      auth: { focus: 'src/auth/' },
      api: { focus: 'src/api/' },
      tests: { focus: 'tests/' },
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

  it('merges clean tasks and tracks state', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Init sync state with merges
    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };
    writeSyncState(withMerges, repoDir);

    // Make a commit on auth branch (in the worktree)
    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'auth.txt', 'auth work', 'auth commit');

    // Switch to target branch and merge auth
    checkout(repoDir, config.target);
    const result = mergeBranch(authWt.branch, repoDir);
    expect(result.success).toBe(true);

    // Update merge state
    const updated = updateMergeEntry(withMerges, 'auth', {
      status: 'merged',
      merged: new Date().toISOString(),
    });
    writeSyncState(updated, repoDir);

    const read = readSyncState(repoDir);
    expect(read?.merges?.['auth']?.status).toBe('merged');
    expect(read?.merges?.['api']?.status).toBe('pending');
  });

  it('records conflict status and leaves git in merge state', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Make conflicting commits on both target and auth branch
    checkout(repoDir, config.target);
    commitFile(repoDir, 'shared.txt', 'target-content', 'target commit');

    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'shared.txt', 'auth-content', 'auth commit');

    // Switch to target and attempt merge
    checkout(repoDir, config.target);
    const result = mergeBranch(authWt.branch, repoDir);
    expect(result.success).toBe(false);
    expect(isMergeInProgress(repoDir)).toBe(true);
  });

  it('skips tasks with no commits', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };

    // api has no commits -- should be skipped
    const updated = updateMergeEntry(withMerges, 'api', {
      status: 'skipped',
    });
    writeSyncState(updated, repoDir);

    const read = readSyncState(repoDir);
    expect(read?.merges?.['api']?.status).toBe('skipped');
  });
});

describe('isAncestor (paw-0yqg)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns true when branch is ancestor of HEAD', () => {
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'a.txt', 'a', 'feature commit');

    execFileSync('git', ['checkout', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    mergeBranch('feature', repoDir);

    expect(isAncestor('feature', 'HEAD', repoDir)).toBe(true);
  });

  it('returns false when branch is not ancestor of HEAD', () => {
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'a.txt', 'a', 'feature commit');

    execFileSync('git', ['checkout', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    // feature has commits not in main
    expect(isAncestor('feature', 'HEAD', repoDir)).toBe(false);
  });
});

describe('stashWorkingTree / unstashWorkingTree', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('stashes and restores untracked files', () => {
    writeFileSync(resolve(repoDir, 'untracked.txt'), 'local work');

    const stashed = stashWorkingTree(repoDir);
    expect(stashed).toBe(true);

    // File should be gone after stash
    expect(existsSync(resolve(repoDir, 'untracked.txt'))).toBe(false);

    unstashWorkingTree(repoDir);

    // File should be restored
    expect(existsSync(resolve(repoDir, 'untracked.txt'))).toBe(true);
    expect(readFileSync(resolve(repoDir, 'untracked.txt'), 'utf-8')).toBe('local work');
  });

  it('returns false when working tree is clean', () => {
    const stashed = stashWorkingTree(repoDir);
    expect(stashed).toBe(false);
  });

  it('allows merge with unrelated untracked files present', () => {
    // Create a branch with a file
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'feature.txt', 'feature work', 'add feature');

    // Go back to main, create an unrelated untracked file
    execFileSync('git', ['checkout', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    writeFileSync(resolve(repoDir, 'local-notes.txt'), 'my notes');

    // Stash, merge, unstash
    const stashed = stashWorkingTree(repoDir);
    expect(stashed).toBe(true);

    const result = mergeBranch('feature', repoDir);
    expect(result.success).toBe(true);

    unstashWorkingTree(repoDir);

    // Untracked file should be restored, no junk commit in log
    expect(readFileSync(resolve(repoDir, 'local-notes.txt'), 'utf-8')).toBe('my notes');
    const log = git(['log', '--oneline'], { cwd: repoDir });
    expect(log).not.toContain('paw: stage untracked');
  });

  it('stash pops even when merge hits a conflict', () => {
    // Create conflicting branches
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'shared.txt', 'feature-content', 'feature commit');

    execFileSync('git', ['checkout', 'main'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    commitFile(repoDir, 'shared.txt', 'main-content', 'main commit');

    // Create an untracked file
    writeFileSync(resolve(repoDir, 'local-wip.txt'), 'work in progress');

    const stashed = stashWorkingTree(repoDir);
    expect(stashed).toBe(true);
    expect(existsSync(resolve(repoDir, 'local-wip.txt'))).toBe(false);

    // Merge conflicts
    const result = mergeBranch('feature', repoDir);
    expect(result.success).toBe(false);

    // Abort the merge, then pop stash
    execFileSync('git', ['merge', '--abort'], { cwd: repoDir, stdio: 'pipe' });

    unstashWorkingTree(repoDir);
    expect(readFileSync(resolve(repoDir, 'local-wip.txt'), 'utf-8')).toBe('work in progress');
  });
});

describe('merge --continue flow', () => {
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

  it('resolves conflict and resumes merging remaining tasks', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Make conflicting changes on auth
    checkout(repoDir, config.target);
    commitFile(repoDir, 'shared.txt', 'target-content', 'target commit');

    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'shared.txt', 'auth-content', 'auth commit');

    // Make a clean commit on api
    const apiWt = worktrees.find((w) => w.taskName === 'api')!;
    commitFile(apiWt.worktreePath, 'api.txt', 'api work', 'api commit');

    // Init merge state
    const state = initSyncState(config.target, Object.keys(config.tasks), 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(Object.keys(config.tasks)),
    };
    writeSyncState(withMerges, repoDir);

    // Attempt merge of auth -- conflicts
    checkout(repoDir, config.target);
    const result = mergeBranch(authWt.branch, repoDir);
    expect(result.success).toBe(false);

    // Record conflict in state
    const conflictState = updateMergeEntry(withMerges, 'auth', {
      status: 'conflict',
    });
    writeSyncState(conflictState, repoDir);

    // Simulate user resolving: write the file and commit
    writeFileSync(resolve(repoDir, 'shared.txt'), 'resolved-content');
    execFileSync('git', ['add', 'shared.txt'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    execFileSync('git', ['commit', '--no-edit'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    // Verify merge is no longer in progress
    expect(isMergeInProgress(repoDir)).toBe(false);

    // --continue: mark auth as merged
    const resolvedState = updateMergeEntry(conflictState, 'auth', {
      status: 'merged',
      merged: new Date().toISOString(),
    });
    writeSyncState(resolvedState, repoDir);

    // Now merge api -- should succeed
    const apiResult = mergeBranch(apiWt.branch, repoDir);
    expect(apiResult.success).toBe(true);

    const finalState = updateMergeEntry(resolvedState, 'api', {
      status: 'merged',
      merged: new Date().toISOString(),
    });
    writeSyncState(finalState, repoDir);

    // Verify final state
    const read = readSyncState(repoDir);
    expect(read?.merges?.['auth']?.status).toBe('merged');
    expect(read?.merges?.['api']?.status).toBe('merged');
  });
});
