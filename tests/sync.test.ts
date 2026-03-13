import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
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
} from '../src/lib/sync.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { deleteBranch, createBranch, createWorktree, removeWorktree } from '../src/lib/git.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('initSyncState', () => {
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

describe('submitForReview', () => {
  it('sets status to in_review', () => {
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');

    expect(reviewed.tasks['auth']?.status).toBe('in_review');
    expect(reviewed.tasks['api']?.status).toBe('pending');
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');

    expect(() => submitForReview(state, 'nope')).toThrow('Task not found in sync state: nope');
  });
});

describe('isTerminalStatus', () => {
  it('returns true for done', () => {
    expect(isTerminalStatus('done')).toBe(true);
  });

  it('returns false for in_review', () => {
    expect(isTerminalStatus('in_review')).toBe(false);
  });

  it('returns false for in_progress', () => {
    expect(isTerminalStatus('in_progress')).toBe(false);
  });

  it('returns false for pending', () => {
    expect(isTerminalStatus('pending')).toBe(false);
  });
});

describe('submitForReview reviewCycle', () => {
  it('increments reviewCycle from 0 to 1', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');

    expect(reviewed.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('increments reviewCycle from 1 to 2', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');
    const cycle1 = submitForReview(claimed, 'auth');
    const reopened = reopenTask(cycle1, 'auth');
    const cycle2 = submitForReview(reopened, 'auth');

    expect(cycle2.tasks['auth']?.reviewCycle).toBe(2);
  });
});

describe('reopenTask', () => {
  it('transitions in_review back to in_progress', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const reviewed = submitForReview(claimTask(state, 'auth'), 'auth');
    const reopened = reopenTask(reviewed, 'auth');

    expect(reopened.tasks['auth']?.status).toBe('in_progress');
  });

  it('preserves reviewCycle on reopen', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    const claimed = claimTask(state, 'auth');
    const reviewed = submitForReview(claimed, 'auth');
    const reopened = reopenTask(reviewed, 'auth');

    expect(reopened.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('throws on unknown task', () => {
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');

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

  it('does not carry inbox entries across remove + re-init', () => {
    initSyncWorktree(repoDir);
    const state1 = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
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
    deleteBranch('paw-sync', repoDir);

    initSyncWorktree(repoDir);
    const state2 = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
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
    // On Windows, git worktree list may return 8.3 short names.
    // Match the suffix to avoid path normalization issues.
    expect(syncDir).toMatch(/\.paw[\\/]sync$/);
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
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
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
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    writeSyncState(state, repoDir);

    const result = readRequiredSyncState(repoDir);
    expect(result.target).toBe('feature/dash');
    expect(result.tasks['auth']?.status).toBe('pending');
  });

  it('exits process when no state exists', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => readRequiredSyncState(repoDir)).toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});

describe('reviewFilePath', () => {
  it('sanitizes branch name and returns review path', () => {
    expect(reviewFilePath('feature/x-auth')).toBe('review/feature-x-auth.md');
  });

  it('replaces all non-alphanumeric-dash characters', () => {
    expect(reviewFilePath('fix/code_quality.v2')).toBe('review/fix-code-quality-v2.md');
  });

  it('handles simple branch names unchanged', () => {
    expect(reviewFilePath('main')).toBe('review/main.md');
  });
});

describe('requireWorktreeTask', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns task name when single .md exists in .paw/tasks/', () => {
    const tasksDir = resolve(repoDir, '.paw', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, 'auth.md'), '# auth task');

    expect(requireWorktreeTask(repoDir)).toBe('auth');
  });

  it('throws when no .paw/tasks/ directory exists', () => {
    expect(() => requireWorktreeTask(repoDir)).toThrow('Could not detect task name');
  });
});
