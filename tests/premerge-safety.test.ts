import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  git,
  getHeadRef,
  createBackupRef,
  cleanupBackupRefs,
  mergeBranch,
  removeWorktree,
} from '../src/lib/git.js';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  initMergeState,
  updateMergeEntry,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { createSession } from '../src/lib/session.js';
import type { PawConfig } from '../src/lib/config.js';

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-premerge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
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

describe('backup refs', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates a backup ref pointing to the correct commit', () => {
    const head = getHeadRef(repoDir);
    createBackupRef('auth', head, repoDir);

    const refValue = git(['rev-parse', 'refs/paw-backup/auth'], { cwd: repoDir, stdio: 'pipe' });
    expect(refValue).toBe(head);
  });

  it('creates multiple backup refs for different tasks', () => {
    const head1 = getHeadRef(repoDir);
    createBackupRef('auth', head1, repoDir);

    commitFile(repoDir, 'file.txt', 'content', 'second commit');
    const head2 = getHeadRef(repoDir);
    createBackupRef('api', head2, repoDir);

    const ref1 = git(['rev-parse', 'refs/paw-backup/auth'], { cwd: repoDir, stdio: 'pipe' });
    const ref2 = git(['rev-parse', 'refs/paw-backup/api'], { cwd: repoDir, stdio: 'pipe' });

    expect(ref1).toBe(head1);
    expect(ref2).toBe(head2);
    expect(ref1).not.toBe(ref2);
  });

  it('cleanupBackupRefs removes all backup refs', () => {
    const head = getHeadRef(repoDir);
    createBackupRef('auth', head, repoDir);
    createBackupRef('api', head, repoDir);

    cleanupBackupRefs(repoDir);

    // Verify refs are gone
    expect(() =>
      git(['rev-parse', 'refs/paw-backup/auth'], {
        cwd: repoDir,
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(() =>
      git(['rev-parse', 'refs/paw-backup/api'], {
        cwd: repoDir,
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('cleanupBackupRefs is safe when no backup refs exist', () => {
    expect(() => cleanupBackupRefs(repoDir)).not.toThrow();
  });
});

describe('backup refs during merge', () => {
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

  it('backup ref allows rollback after merge', () => {
    const worktrees = createSession(config, repoDir);
    worktreePaths = worktrees.map((w) => w.worktreePath);

    // Make a commit on auth
    const authWt = worktrees.find((w) => w.taskName === 'auth')!;
    commitFile(authWt.worktreePath, 'auth.txt', 'auth work', 'auth commit');

    // Switch to target
    checkout(repoDir, config.target);
    const headBefore = getHeadRef(repoDir);

    // Save backup and merge
    createBackupRef('auth', headBefore, repoDir);
    const result = mergeBranch(authWt.branch, repoDir);
    expect(result.success).toBe(true);

    // HEAD has changed after merge
    const headAfter = getHeadRef(repoDir);
    expect(headAfter).not.toBe(headBefore);

    // Rollback using backup ref
    execFileSync('git', ['reset', '--hard', 'refs/paw-backup/auth'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    const headRestored = getHeadRef(repoDir);
    expect(headRestored).toBe(headBefore);
  });
});

describe('hook_failed status display', () => {
  it('paw status renders hook_failed merge state', () => {
    const dir = makeTempDir();
    gitInit(dir);

    // Create paw config so status command can load it
    const pawDir = resolve(dir, '.paw');
    mkdirSync(pawDir, { recursive: true });
    writeFileSync(
      resolve(pawDir, 'paw.yaml'),
      `target: feature/dash\ntasks:\n  auth:\n    focus: src/auth/\n  api:\n    focus: src/api/\n`,
    );

    // Set up sync state with hook_failed
    initSyncWorktree(dir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };
    const hookFailed = updateMergeEntry(withMerges, 'auth', {
      status: 'hook_failed' as const,
    });
    writeSyncState(hookFailed, dir);

    // Run paw status via the built CLI entry point
    const testDir = dirname(fileURLToPath(import.meta.url));
    const binPath = resolve(testDir, '..', 'dist', 'bin.mjs');
    const output = execFileSync(process.execPath, [binPath, 'status'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain('hook failed');

    removeSyncWorktree(dir);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('hook_failed merge status', () => {
  it('round-trips hook_failed status through sync state', () => {
    const dir = makeTempDir();
    gitInit(dir);
    initSyncWorktree(dir);

    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };
    writeSyncState(withMerges, dir);

    const updated = updateMergeEntry(withMerges, 'auth', {
      status: 'hook_failed',
    });
    writeSyncState(updated, dir);

    const read = readSyncState(dir);
    expect(read?.merges?.['auth']?.status).toBe('hook_failed');
    expect(read?.merges?.['api']?.status).toBe('pending');

    removeSyncWorktree(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it('continues from hook_failed to merged', () => {
    const dir = makeTempDir();
    gitInit(dir);
    initSyncWorktree(dir);

    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const withMerges = {
      ...state,
      merges: initMergeState(['auth', 'api']),
    };

    const hookFailed = updateMergeEntry(withMerges, 'auth', {
      status: 'hook_failed',
    });
    writeSyncState(hookFailed, dir);

    // Simulate --continue: mark as merged
    const resolved = updateMergeEntry(hookFailed, 'auth', {
      status: 'merged',
      merged: new Date().toISOString(),
    });
    writeSyncState(resolved, dir);

    const read = readSyncState(dir);
    expect(read?.merges?.['auth']?.status).toBe('merged');

    removeSyncWorktree(dir);
    rmSync(dir, { recursive: true, force: true });
  });
});
