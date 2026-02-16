import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  initSyncState,
  claimTask,
  completeTask,
  findFirstPendingTask,
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
} from '../src/lib/sync.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { deleteBranch, createBranch, createWorktree, removeWorktree } from '../src/lib/git.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('initSyncState', () => {
  it('creates state with all tasks pending', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');

    expect(state.target).toBe('feature/dash');
    expect(state.config).toBe('paw.yaml');
    expect(Object.keys(state.tasks)).toEqual(['auth', 'api']);
    expect(state.tasks['auth']?.status).toBe('pending');
    expect(state.tasks['api']?.status).toBe('pending');
    expect(state.session).toBeTruthy();
  });

  it('stores focus areas when focusMap is provided', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml', {
      auth: ['src/auth/', 'src/middleware/auth.ts'],
      api: ['src/api/'],
    });

    expect(state.tasks['auth']?.focus).toEqual(['src/auth/', 'src/middleware/auth.ts']);
    expect(state.tasks['api']?.focus).toEqual(['src/api/']);
  });

  it('omits focus when focusMap is not provided', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');

    expect(state.tasks['auth']?.focus).toBeUndefined();
  });
});

describe('claimTask', () => {
  it('sets status to in_progress with timestamp', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');

    expect(claimed.tasks['auth']?.status).toBe('in_progress');
    expect(claimed.tasks['auth']?.claimed).toBeTruthy();
    expect(claimed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');

    expect(() => claimTask(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('completeTask', () => {
  it('sets status to done with timestamp', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const completed = completeTask(state, 'auth');

    expect(completed.tasks['auth']?.status).toBe('done');
    expect(completed.tasks['auth']?.doneAt).toBeTruthy();
    expect(completed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');

    expect(() => completeTask(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('findFirstPendingTask', () => {
  it('returns the first task when none are claimed', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    expect(findFirstPendingTask(state)).toBe('auth');
  });

  it('skips in_progress tasks and returns next pending', () => {
    const state = initSyncState('feature/dash', ['auth', 'api', 'ui'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');
    expect(findFirstPendingTask(claimed)).toBe('api');
  });

  it('skips completed tasks and returns next pending', () => {
    const state = initSyncState('feature/dash', ['auth', 'api', 'ui'], 'paw.yaml');
    const completed = completeTask(state, 'auth');
    expect(findFirstPendingTask(completed)).toBe('api');
  });

  it('returns null when all tasks are in_progress', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const s1 = claimTask(state, 'auth');
    const s2 = claimTask(s1, 'api');
    expect(findFirstPendingTask(s2)).toBeNull();
  });

  it('returns null when all tasks are completed', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const completed = completeTask(state, 'auth');
    expect(findFirstPendingTask(completed)).toBeNull();
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
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncState(state, repoDir);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.target).toBe('feature/dash');
    expect(read!.config).toBe('paw.yaml');
    expect(Object.keys(read!.tasks)).toEqual(['auth', 'api']);
    expect(read!.tasks['auth']?.status).toBe('pending');
  });

  it('overwrites previous state on second write', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
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
    const content = '# Summary\n\nDid some work.';
    writeSyncFile('summaries/auth.md', content, repoDir);

    const read = readSyncFile('summaries/auth.md', repoDir);
    expect(read).toBe(content);
  });

  it('preserves existing files when writing new ones', () => {
    writeSyncFile('summaries/auth.md', 'auth summary', repoDir);
    writeSyncFile('summaries/api.md', 'api summary', repoDir);

    expect(readSyncFile('summaries/auth.md', repoDir)).toBe('auth summary');
    expect(readSyncFile('summaries/api.md', repoDir)).toBe('api summary');
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
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const completed = completeTask(state, 'auth');

    writeSyncStateAndFiles(
      completed,
      [{ path: 'summaries/auth.md', content: 'auth done' }],
      repoDir,
    );

    const readState = readSyncState(repoDir);
    expect(readState?.tasks['auth']?.status).toBe('done');

    const summary = readSyncFile('summaries/auth.md', repoDir);
    expect(summary).toBe('auth done');
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
    expect(listSyncDir('summaries', repoDir)).toEqual([]);
  });

  it('lists files under a prefix', () => {
    writeSyncFile('summaries/auth.md', 'auth summary', repoDir);
    writeSyncFile('summaries/api.md', 'api summary', repoDir);

    const files = listSyncDir('summaries', repoDir);
    expect(files).toContain('summaries/auth.md');
    expect(files).toContain('summaries/api.md');
    expect(files).toHaveLength(2);
  });
});

describe('session leak (paw-pm8q)', () => {
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

  it('does not carry journal entries across remove + re-init', () => {
    initSyncWorktree(repoDir);
    const state1 = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncStateAndFiles(
      state1,
      [
        { path: 'journal/.gitkeep', content: '' },
        { path: 'journal/auth.jsonl', content: '{"msg":"old entry"}' },
      ],
      repoDir,
    );

    expect(readSyncFile('journal/auth.jsonl', repoDir)).toBe('{"msg":"old entry"}');

    removeSyncWorktree(repoDir);
    deleteBranch('paw-sync', repoDir);

    initSyncWorktree(repoDir);
    const state2 = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncStateAndFiles(state2, [{ path: 'journal/.gitkeep', content: '' }], repoDir);

    expect(readSyncFile('journal/auth.jsonl', repoDir)).toBeNull();
    expect(listSyncDir('journal', repoDir)).toEqual(['journal/.gitkeep']);

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

  it('creates orphan worktree when no paw-sync branch exists', () => {
    const wtPath = initSyncWorktree(repoDir);

    expect(wtPath).toBe(resolve(repoDir, '.paw', 'sync'));
    expect(existsSync(resolve(wtPath, '.git'))).toBe(true);
  });

  it('creates worktree from existing paw-sync branch', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
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
    taskWorktreePath = resolve(repoDir, '..', `${repoDir.split(/[\\/]/).pop()}-paw-auth`);
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
    expect(syncDir).toBe(resolve(repoDir, '.paw', 'sync'));
  });

  it('resolves from a task worktree to the main repo .paw/sync/', () => {
    const syncDir = resolveSyncDir(taskWorktreePath);
    expect(syncDir).toBe(resolve(repoDir, '.paw', 'sync'));
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

  it('archives state.json, journal, and summaries', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncState(state, repoDir);
    writeSyncFile('journal/auth.jsonl', '{"type":"broadcast"}\n', repoDir);
    writeSyncFile('summaries/auth.md', '# Auth summary\n', repoDir);

    const archivePath = archiveSession(repoDir, 'feature/dash');

    expect(archivePath).not.toBeNull();
    expect(archivePath!).toContain('feature-dash');
    expect(existsSync(resolve(archivePath!, 'state.json'))).toBe(true);
    expect(existsSync(resolve(archivePath!, 'journal', 'auth.jsonl'))).toBe(true);
    expect(existsSync(resolve(archivePath!, 'summaries', 'auth.md'))).toBe(true);
  });

  it('copies paw.yaml from .paw/ into archive', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    writeSyncState(state, repoDir);

    // Write a paw.yaml in .paw/
    const configDir = resolve(repoDir, '.paw');
    writeFileSync(resolve(configDir, 'paw.yaml'), 'target: feature/dash\n');

    const archivePath = archiveSession(repoDir, 'feature/dash');

    expect(existsSync(resolve(archivePath!, 'paw.yaml'))).toBe(true);
    expect(readFileSync(resolve(archivePath!, 'paw.yaml'), 'utf-8')).toBe('target: feature/dash\n');
  });

  it('uses session date from state.json for folder name', () => {
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    writeSyncState(state, repoDir);

    const archivePath = archiveSession(repoDir, 'feature/dash');

    const folderName = archivePath!.split(/[\\/]/).pop()!;
    // Folder should start with a date prefix like 2026-02-14
    expect(folderName).toMatch(/^\d{4}-\d{2}-\d{2}-feature-dash$/);
  });
});
