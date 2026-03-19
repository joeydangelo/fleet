import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  claimTask,
  completeTask,
  submitForReview,
  reopenTask,
  isTerminalStatus,
  writeSyncState,
  readSyncState,
  writeSyncFile,
  readSyncFile,
  writeSyncStateAndFiles,
  listSyncDir,
  initSyncWorktree,
  removeSyncWorktree,
  resolveSyncDir,
  archiveSession,
  readRequiredSyncState,
  reviewFilePath,
  requireWorktreeTask,
  claimTaskAtomic,
  updateLastCheck,
} from '../src/lib/sync.js';
import { deleteBranch, createBranch, createWorktree, removeWorktree } from '../src/lib/git.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('initSyncState', () => {
  it('stores focus areas when focusMap is provided', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml', {
      auth: ['src/auth/', 'src/middleware/auth.ts'],
      api: ['src/api/'],
    });

    expect(state.tasks['auth']?.focus).toEqual(['src/auth/', 'src/middleware/auth.ts']);
    expect(state.tasks['api']?.focus).toEqual(['src/api/']);
  });

  it('omits focus when focusMap is not provided', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');

    expect(state.tasks['auth']?.focus).toBeUndefined();
  });
});

describe('claimTask', () => {
  it('sets status to in_progress with timestamp', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    const claimed = claimTask(state, 'auth');

    expect(claimed.tasks['auth']?.status).toBe('in_progress');
    expect(claimed.tasks['auth']?.claimed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(claimed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');

    expect(() => claimTask(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('completeTask', () => {
  it('sets status to done with timestamp', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    const completed = completeTask(state, 'auth');

    expect(completed.tasks['auth']?.status).toBe('done');
    expect(completed.tasks['auth']?.doneAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(completed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');

    expect(() => completeTask(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('submitForReview', () => {
  it('sets status to in_review', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');

    expect(reviewed.tasks['auth']?.status).toBe('in_review');
    expect(reviewed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');

    expect(() => submitForReview(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('isTerminalStatus', () => {
  it.each([
    ['done', true],
    ['pending', false],
  ] as const)('isTerminalStatus(%s) → %s', (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});

describe('submitForReview reviewCycle', () => {
  it('increments reviewCycle from 0 to 1', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');

    expect(reviewed.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('increments reviewCycle from 1 to 2', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    const claimed = claimTask(state, 'auth');
    const cycle1 = submitForReview(claimed, 'auth');
    const reopened = reopenTask(cycle1, 'auth');
    const cycle2 = submitForReview(reopened, 'auth');

    expect(cycle2.tasks['auth']?.reviewCycle).toBe(2);
  });
});

describe('reopenTask', () => {
  it('transitions in_review back to in_progress', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    const reviewed = submitForReview(claimTask(state, 'auth'), 'auth');
    const reopened = reopenTask(reviewed, 'auth');

    expect(reopened.tasks['auth']?.status).toBe('in_progress');
  });

  it('preserves reviewCycle on reopen', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');
    const reopened = reopenTask(reviewed, 'auth');

    expect(reopened.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');

    expect(() => reopenTask(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('writeSyncState / readSyncState', () => {
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

  it('returns null when no state file exists', () => {
    expect(readSyncState(repoDir)).toBeNull();
  });

  it('round-trips sync state through the worktree', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.target).toBe('feature/dash');
    expect(read!.config).toBe('fleet.yaml');
    expect(Object.keys(read!.tasks)).toEqual(['auth', 'api']);
    expect(read!.tasks['auth']?.status).toBe('pending');
  });

  it('throws on corrupt JSON instead of returning null', () => {
    const syncDir = resolveSyncDir(repoDir);
    writeFileSync(resolve(syncDir, 'state.json'), '{not valid json!!!');

    expect(() => readSyncState(repoDir)).toThrow();
  });

  it('overwrites previous state on second write', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const updated = claimTask(state, 'auth');
    writeSyncState(updated, repoDir);

    const read = readSyncState(repoDir);
    expect(read!.tasks['auth']?.status).toBe('in_progress');
  });
});

describe('writeSyncFile / readSyncFile', () => {
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

  it('returns null when file does not exist', () => {
    expect(readSyncFile('nonexistent.md', repoDir)).toBeNull();
  });

  it('round-trips a file through the sync worktree', () => {
    const content = '# Review: auth\n\nFindings here.';
    writeSyncFile('review/auth.md', content, repoDir);

    const read = readSyncFile('review/auth.md', repoDir);
    expect(read).toBe(content);
  });

  it('preserves existing files when writing new ones', () => {
    writeSyncFile('review/auth.md', 'auth findings', repoDir);
    writeSyncFile('review/api.md', 'api findings', repoDir);

    expect(readSyncFile('review/auth.md', repoDir)).toBe('auth findings');
    expect(readSyncFile('review/api.md', repoDir)).toBe('api findings');
  });

  it('throws on non-ENOENT errors instead of returning null', () => {
    // Reading a directory as a file throws EISDIR
    writeSyncFile('review/auth.md', 'findings', repoDir);
    expect(() => readSyncFile('review', repoDir)).toThrow();
  });
});

describe('writeSyncStateAndFiles', () => {
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

  it('writes state and files atomically', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    const completed = completeTask(state, 'auth');

    writeSyncStateAndFiles(completed, [{ path: 'review/auth.md', content: 'auth done' }], repoDir);

    const readState = readSyncState(repoDir);
    expect(readState?.tasks['auth']?.status).toBe('done');

    const findings = readSyncFile('review/auth.md', repoDir);
    expect(findings).toBe('auth done');
  });
});

describe('listSyncDir', () => {
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

  it('returns empty array when directory does not exist', () => {
    expect(listSyncDir('review', repoDir)).toEqual([]);
  });

  it('lists files under a prefix', () => {
    writeSyncFile('review/auth.md', 'auth findings', repoDir);
    writeSyncFile('review/api.md', 'api findings', repoDir);

    const files = listSyncDir('review', repoDir);
    expect(files).toContain('review/auth.md');
    expect(files).toContain('review/api.md');
    expect(files).toHaveLength(2);
  });

  it('throws on non-ENOENT errors instead of returning empty array', () => {
    // Listing a file as a directory throws ENOTDIR
    writeSyncFile('not-a-dir', 'content', repoDir);
    expect(() => listSyncDir('not-a-dir', repoDir)).toThrow();
  });
});

describe('session leak (fleet-pm8q)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    try {
      removeSyncWorktree(repoDir);
    } catch {
      // already removed
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('does not carry inbox entries across remove + re-init', () => {
    initSyncWorktree(repoDir);
    const state1 = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncStateAndFiles(
      state1,
      [
        { path: 'inbox/.gitkeep', content: '' },
        { path: 'inbox/auth.jsonl', content: '{"msg":"old entry"}' },
      ],
      repoDir,
    );

    expect(readSyncFile('inbox/auth.jsonl', repoDir)).toBe('{"msg":"old entry"}');

    removeSyncWorktree(repoDir);
    deleteBranch('fleet-sync', repoDir);

    initSyncWorktree(repoDir);
    const state2 = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncStateAndFiles(state2, [{ path: 'inbox/.gitkeep', content: '' }], repoDir);

    expect(readSyncFile('inbox/auth.jsonl', repoDir)).toBeNull();
    expect(listSyncDir('inbox', repoDir)).toEqual(['inbox/.gitkeep']);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.tasks['auth']?.status).toBe('pending');
  });
});

describe('initSyncWorktree / removeSyncWorktree', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    try {
      removeSyncWorktree(repoDir);
    } catch {
      // already removed
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('creates orphan worktree when no fleet-sync branch exists', () => {
    const wtPath = initSyncWorktree(repoDir);

    expect(wtPath).toBe(resolve(repoDir, '.fleet', 'sync'));
    expect(existsSync(resolve(wtPath, '.git'))).toBe(true);
  });

  it('creates worktree from existing fleet-sync branch', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);
    removeSyncWorktree(repoDir);

    const wtPath = initSyncWorktree(repoDir);

    expect(existsSync(resolve(wtPath, '.git'))).toBe(true);
    expect(existsSync(resolve(wtPath, 'state.json'))).toBe(true);
  });

  it('is idempotent -- calling twice does not error', () => {
    initSyncWorktree(repoDir);
    const wtPath = initSyncWorktree(repoDir);

    expect(existsSync(resolve(wtPath, '.git'))).toBe(true);
  });

  it('removes an existing worktree', () => {
    const wtPath = initSyncWorktree(repoDir);
    expect(existsSync(wtPath)).toBe(true);

    removeSyncWorktree(repoDir);

    expect(existsSync(wtPath)).toBe(false);
  });

  it('removeSyncWorktree is idempotent -- no error if no worktree', () => {
    removeSyncWorktree(repoDir);
  });
});

describe('resolveSyncDir', () => {
  let repoDir: string;
  let taskWorktreePath: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    createBranch('feature-auth', 'HEAD', repoDir);
    taskWorktreePath = resolve(repoDir, '..', `${repoDir.split(/[\\/]/).pop()}-fleet-auth`);
    createWorktree(taskWorktreePath, 'feature-auth', repoDir);
  });

  afterEach(() => {
    try {
      removeWorktree(taskWorktreePath, repoDir);
    } catch {
      // already removed
    }
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(taskWorktreePath, { recursive: true, force: true });
  });

  it('resolves from the main repo directory', () => {
    const syncDir = resolveSyncDir(repoDir);
    expect(syncDir).toBe(resolve(repoDir, '.fleet', 'sync'));
  });

  it('resolves from a task worktree to the main repo .fleet/sync/', () => {
    const syncDir = resolveSyncDir(taskWorktreePath);
    // On Windows, git worktree list may return 8.3 short names.
    // Match the suffix to avoid path normalization issues.
    expect(syncDir).toMatch(/\.fleet[\\/]sync$/);
  });
});

describe('archiveSession', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    try {
      removeSyncWorktree(repoDir);
    } catch {
      // already removed
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns null when no sync worktree exists', () => {
    expect(archiveSession(repoDir, 'feature/foo')).toBeNull();
  });

  it('archives state.json, inbox, and review findings', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncState(state, repoDir);
    writeSyncFile('inbox/auth.jsonl', '{"type":"broadcast"}\n', repoDir);
    writeSyncFile('review/auth.md', '# Review findings\n', repoDir);

    const archivePath = archiveSession(repoDir, 'feature/dash');

    expect(archivePath).not.toBeNull();
    expect(archivePath!).toContain('feature-dash');
    expect(existsSync(resolve(archivePath!, 'state.json'))).toBe(true);
    expect(existsSync(resolve(archivePath!, 'inbox', 'auth.jsonl'))).toBe(true);
    expect(existsSync(resolve(archivePath!, 'review', 'auth.md'))).toBe(true);
  });

  it('copies fleet.yaml from .fleet/ into archive', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    // Write a fleet.yaml in .fleet/
    const configDir = resolve(repoDir, '.fleet');
    writeFileSync(resolve(configDir, 'fleet.yaml'), 'target: feature/dash\n');

    const archivePath = archiveSession(repoDir, 'feature/dash');

    expect(existsSync(resolve(archivePath!, 'fleet.yaml'))).toBe(true);
    expect(readFileSync(resolve(archivePath!, 'fleet.yaml'), 'utf-8')).toBe(
      'target: feature/dash\n',
    );
  });

  it('uses session date from state.json for folder name', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const archivePath = archiveSession(repoDir, 'feature/dash');

    const folderName = archivePath!.split(/[\\/]/).pop()!;
    // Folder should start with a date prefix like 2026-02-14
    expect(folderName).toMatch(/^\d{4}-\d{2}-\d{2}-feature-dash$/);
  });
});

describe('readRequiredSyncState', () => {
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

  it('returns state when it exists', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const result = readRequiredSyncState(repoDir);
    expect(result.target).toBe('feature/dash');
    expect(result.tasks['auth']?.status).toBe('pending');
  });

  it('throws when no state exists', () => {
    expect(() => readRequiredSyncState(repoDir)).toThrow('No sync state found');
  });
});

describe('reviewFilePath', () => {
  it('sanitizes branch name and returns review path', () => {
    expect(reviewFilePath('feature/auth')).toBe('review/feature-auth.md');
  });

  it('replaces non-alphanumeric chars with hyphens', () => {
    expect(reviewFilePath('fix/tech-debt-cleanup-lib-layer')).toBe(
      'review/fix-tech-debt-cleanup-lib-layer.md',
    );
  });

  it('handles simple branch names', () => {
    expect(reviewFilePath('main')).toBe('review/main.md');
  });
});

describe('requireWorktreeTask', () => {
  it('returns task name when .fleet/tasks/ has exactly one .md file', () => {
    const dir = makeTempDir();
    mkdirSync(resolve(dir, '.fleet', 'tasks'), { recursive: true });
    writeFileSync(resolve(dir, '.fleet', 'tasks', 'auth.md'), '# auth');
    expect(requireWorktreeTask(dir)).toBe('auth');
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when not in a worktree', () => {
    const dir = makeTempDir();
    expect(() => requireWorktreeTask(dir)).toThrow('Not in a fleet worktree');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('claimTaskAtomic', () => {
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

  it('claims a pending task and persists to git', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    claimTaskAtomic('auth', repoDir);

    const read = readSyncState(repoDir);
    expect(read!.tasks['auth']?.status).toBe('in_progress');
    expect(read!.tasks['auth']?.claimed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(read!.tasks['api']?.status).toBe('pending');
  });

  it('is a no-op for a task already in_progress', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    state.tasks['auth']!.status = 'in_progress';
    writeSyncState(state, repoDir);

    // Should return without error (early return for non-pending task)
    claimTaskAtomic('auth', repoDir);

    const read = readSyncState(repoDir);
    expect(read!.tasks['auth']?.status).toBe('in_progress');
  });

  it('throws ExternalCommandError when sync lock cannot be acquired', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const syncDir = resolveSyncDir(repoDir);
    // Simulate a held lock by pre-creating the lock directory with a fresh mtime
    const lockPath = resolve(syncDir, '.fleet-sync-lock');
    mkdirSync(lockPath, { recursive: true });
    // Touch the lock so it doesn't look stale (stale = >30s)
    const now = new Date();
    utimesSync(lockPath, now, now);

    try {
      expect(() => claimTaskAtomic('auth', repoDir)).toThrow(
        /Failed to acquire sync lock after 10 attempts/,
      );
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('recovers from a stale lock and succeeds', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const syncDir = resolveSyncDir(repoDir);
    const lockPath = resolve(syncDir, '.fleet-sync-lock');
    mkdirSync(lockPath, { recursive: true });
    // Set mtime to 60s ago so it looks stale (threshold is 30s)
    const staleTime = new Date(Date.now() - 60_000);
    utimesSync(lockPath, staleTime, staleTime);

    // Should succeed — stale lock gets force-removed
    claimTaskAtomic('auth', repoDir);

    const read = readSyncState(repoDir);
    expect(read!.tasks['auth']?.status).toBe('in_progress');
  });
});

describe('updateLastCheck', () => {
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

  it('persists lastCheck cursor to git', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    updateLastCheck('auth', repoDir);

    const read = readSyncState(repoDir);
    expect(read!.lastCheck?.['auth']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws ExternalCommandError when sync lock cannot be acquired', () => {
    const state = initSyncState('feature/dash', ['auth'], 'fleet.yaml');
    writeSyncState(state, repoDir);

    const syncDir = resolveSyncDir(repoDir);
    const lockPath = resolve(syncDir, '.fleet-sync-lock');
    mkdirSync(lockPath, { recursive: true });
    const now = new Date();
    utimesSync(lockPath, now, now);

    try {
      expect(() => updateLastCheck('auth', repoDir)).toThrow(
        /Failed to acquire sync lock after 10 attempts/,
      );
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });
});
