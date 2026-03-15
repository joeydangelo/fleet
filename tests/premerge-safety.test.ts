import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  git,
  getHeadRef,
  createBackupRef,
  cleanupBackupRefs,
  mergeBranch,
  removeWorktree,
} from '../src/lib/git.js';
import { initSyncWorktree, removeSyncWorktree } from '../src/lib/sync.js';
import { createSession } from '../src/lib/session.js';
import type { FleetConfig } from '../src/lib/config.js';
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

    const refValue = git(['rev-parse', 'refs/fleet-backup/auth'], { cwd: repoDir, stdio: 'pipe' });
    expect(refValue).toBe(head);
  });

  it('creates multiple backup refs for different tasks', () => {
    const head1 = getHeadRef(repoDir);
    createBackupRef('auth', head1, repoDir);

    commitFile(repoDir, 'file.txt', 'content', 'second commit');
    const head2 = getHeadRef(repoDir);
    createBackupRef('api', head2, repoDir);

    const ref1 = git(['rev-parse', 'refs/fleet-backup/auth'], { cwd: repoDir, stdio: 'pipe' });
    const ref2 = git(['rev-parse', 'refs/fleet-backup/api'], { cwd: repoDir, stdio: 'pipe' });

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
      git(['rev-parse', 'refs/fleet-backup/auth'], {
        cwd: repoDir,
        stdio: 'pipe',
      }),
    ).toThrow();
    expect(() =>
      git(['rev-parse', 'refs/fleet-backup/api'], {
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

  const config: FleetConfig = {
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

    // Merged file should now exist
    expect(existsSync(resolve(repoDir, 'auth.txt'))).toBe(true);

    // Rollback using backup ref
    execFileSync('git', ['reset', '--hard', 'refs/fleet-backup/auth'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    const headRestored = getHeadRef(repoDir);
    expect(headRestored).toBe(headBefore);

    // Merged file should be gone after rollback
    expect(existsSync(resolve(repoDir, 'auth.txt'))).toBe(false);
  });
});
