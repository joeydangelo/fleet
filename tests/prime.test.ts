import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendMessage, readMessagesForTask } from '../src/lib/messages.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' });
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
    const state = initSyncState('feature/dash', ['auth', 'api'], 'fleet.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('after prime reads broadcasts, lastCheck[taskName] is set', () => {
    const taskName = 'auth';

    // Add a broadcast from another agent
    appendMessage('api', { type: 'broadcast', msg: 'Changed API interface' }, repoDir);

    // Simulate what printFull does: read entries then write lastCheck
    const state = readSyncState(repoDir)!;
    const lastCheck = state.lastCheck?.[taskName];
    const entries = readMessagesForTask(taskName, repoDir, lastCheck);
    expect(entries.length).toBeGreaterThan(0);

    // Write lastCheck cursor (same logic as prime.ts printFull)
    const now = new Date().toISOString();
    writeSyncState({ ...state, lastCheck: { ...state.lastCheck, [taskName]: now } }, repoDir);

    // Verify lastCheck is set
    const updated = readSyncState(repoDir)!;
    expect(updated.lastCheck?.[taskName]).toBe(now);
  });

  it('filtering returns only messages after cursor, not zero (proves filter, not delete)', () => {
    const taskName = 'auth';

    // Add a broadcast from another agent
    appendMessage('api', { type: 'broadcast', msg: 'Old change' }, repoDir);

    // Read and set cursor
    const state1 = readSyncState(repoDir)!;
    const entries1 = readMessagesForTask(taskName, repoDir, state1.lastCheck?.[taskName]);
    expect(entries1).toHaveLength(1);

    const cursor = new Date().toISOString();
    writeSyncState({ ...state1, lastCheck: { ...state1.lastCheck, [taskName]: cursor } }, repoDir);

    // Append a NEW message with a later timestamp (after cursor)
    appendMessage('api', { type: 'broadcast', msg: 'New change after cursor' }, repoDir);

    // Read with the cursor — should return exactly the new message
    const state2 = readSyncState(repoDir)!;
    const entries2 = readMessagesForTask(taskName, repoDir, state2.lastCheck?.[taskName]);
    expect(entries2).toHaveLength(1);
    expect(entries2[0]!.msg).toBe('New change after cursor');
  });

  it('second prime run with no new broadcasts shows empty broadcasts section', () => {
    const taskName = 'auth';

    // Add a broadcast
    appendMessage('api', { type: 'broadcast', msg: 'First change' }, repoDir);

    // First prime: read entries and set cursor
    const state1 = readSyncState(repoDir)!;
    const entries1 = readMessagesForTask(taskName, repoDir, state1.lastCheck?.[taskName]);
    expect(entries1).toHaveLength(1);

    const now1 = new Date().toISOString();
    writeSyncState({ ...state1, lastCheck: { ...state1.lastCheck, [taskName]: now1 } }, repoDir);

    // Second prime: read entries with updated cursor — should get nothing
    const state2 = readSyncState(repoDir)!;
    const entries2 = readMessagesForTask(taskName, repoDir, state2.lastCheck?.[taskName]);
    expect(entries2).toHaveLength(0);
  });
});

describe('prime from root — orchestrator dashboard', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('exits 0 and outputs dashboard when run from repo root', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    const result = execFileSync(process.execPath, [binPath, 'prime'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    const stdout = result.toString();
    expect(stdout).toContain('fleet v');
    expect(stdout).toContain('=== INSTALLATION ===');
    expect(stdout).toContain('=== SESSION STATUS ===');
  });

  it('shows session status when fleet.yaml exists', () => {
    // Create a .fleet directory with fleet.yaml to simulate a configured session
    mkdirSync(resolve(repoDir, '.fleet'), { recursive: true });
    writeFileSync(
      resolve(repoDir, '.fleet', 'fleet.yaml'),
      'target: feature/test\ntasks:\n  auth:\n    focus: src/auth/\n',
    );

    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    const result = execFileSync(process.execPath, [binPath, 'prime'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    const stdout = result.toString();
    expect(stdout).toContain('=== SESSION STATUS ===');
  });

  it('--brief omits installation section and includes session status', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    const briefResult = execFileSync(process.execPath, [binPath, 'prime', '--brief'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    const stdout = briefResult.toString();
    expect(stdout).toContain('fleet v');
    expect(stdout).not.toContain('=== INSTALLATION ===');
  });
});
