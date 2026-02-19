import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendJournalEntry, readJournalForTask } from '../src/lib/journal.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-prime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('prime cursor write', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('after prime reads broadcasts, lastCheck[taskName] is set', () => {
    const taskName = 'auth';

    // Add a broadcast from another agent
    appendJournalEntry('api', { type: 'broadcast', msg: 'Changed API interface' }, repoDir);

    // Simulate what printFull does: read entries then write lastCheck
    const state = readSyncState(repoDir)!;
    const lastCheck = state.lastCheck?.[taskName];
    const entries = readJournalForTask(taskName, repoDir, lastCheck);
    expect(entries.length).toBeGreaterThan(0);

    // Write lastCheck cursor (same logic as prime.ts printFull)
    const now = new Date().toISOString();
    writeSyncState({ ...state, lastCheck: { ...state.lastCheck, [taskName]: now } }, repoDir);

    // Verify lastCheck is set
    const updated = readSyncState(repoDir)!;
    expect(updated.lastCheck?.[taskName]).toBe(now);
  });

  it('second prime run with no new broadcasts shows empty broadcasts section', () => {
    const taskName = 'auth';

    // Add a broadcast
    appendJournalEntry('api', { type: 'broadcast', msg: 'First change' }, repoDir);

    // First prime: read entries and set cursor
    const state1 = readSyncState(repoDir)!;
    const entries1 = readJournalForTask(taskName, repoDir, state1.lastCheck?.[taskName]);
    expect(entries1).toHaveLength(1);

    const now1 = new Date().toISOString();
    writeSyncState({ ...state1, lastCheck: { ...state1.lastCheck, [taskName]: now1 } }, repoDir);

    // Second prime: read entries with updated cursor — should get nothing
    const state2 = readSyncState(repoDir)!;
    const entries2 = readJournalForTask(taskName, repoDir, state2.lastCheck?.[taskName]);
    expect(entries2).toHaveLength(0);
  });
});

describe('prime from root (not inside worktree)', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('exits 1 with error message when run from repo root', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    try {
      execFileSync(process.execPath, [binPath, 'prime'], {
        cwd: repoDir,
        stdio: 'pipe',
      });
      expect.fail('should have exited with code 1');
    } catch (err: any) {
      expect(err.status).toBe(1);
      const stderr = err.stderr?.toString() ?? '';
      expect(stderr).toMatch(/not inside a worktree/i);
      expect(stderr).toMatch(/paw launch/);
    }
  });
});
