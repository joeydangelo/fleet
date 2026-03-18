/**
 * Concurrency stress test for sync worktree operations.
 * Spawns real child processes to simulate multiple agents contending
 * on the same sync worktree simultaneously.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { execFileSync, fork } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  readSyncState,
  readSyncFile,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { makeTempDir } from './helpers/temp.js';

const WORKER = resolve(__dirname, 'helpers/sync-worker.ts');

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

interface WorkerResult {
  ok: boolean;
  task: string;
  operation: string;
  error?: string;
}

/** Spawn a worker process and return a promise that resolves with its result. */
function spawnWorker(repoDir: string, taskName: string, operation: string): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [repoDir, taskName, operation], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      try {
        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          resolve(JSON.parse(lastLine) as WorkerResult);
        } else {
          resolve({ ok: false, task: taskName, operation, error: stderr || `exit ${code}` });
        }
      } catch {
        resolve({
          ok: false,
          task: taskName,
          operation,
          error: stderr || stdout || `exit ${code}`,
        });
      }
    });

    child.on('error', reject);
  });
}

const AGENT_COUNT = 8;
const TASK_NAMES = Array.from({ length: AGENT_COUNT }, (_, i) => `task-${i}`);

describe('sync concurrency — 8 agents', () => {
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

  it('all 8 agents claim their own task without failures', async () => {
    const state = initSyncState('feature/test', TASK_NAMES, 'fleet.yaml');
    writeSyncState(state, repoDir);

    // Spawn all 8 simultaneously
    const results = await Promise.all(TASK_NAMES.map((t) => spawnWorker(repoDir, t, 'claim')));

    // Every agent should succeed
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error('Failures:', failures);
    }
    expect(failures).toHaveLength(0);

    // Verify all 8 tasks are claimed in the final state
    const final = readSyncState(repoDir);
    expect(final).not.toBeNull();
    for (const name of TASK_NAMES) {
      expect(final!.tasks[name]?.status).toBe('in_progress');
      expect(final!.tasks[name]?.claimed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  }, 30_000);

  it('all 8 agents update lastCheck without failures', async () => {
    const state = initSyncState('feature/test', TASK_NAMES, 'fleet.yaml');
    writeSyncState(state, repoDir);

    const results = await Promise.all(TASK_NAMES.map((t) => spawnWorker(repoDir, t, 'lastcheck')));

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error('Failures:', failures);
    }
    expect(failures).toHaveLength(0);

    const final = readSyncState(repoDir);
    expect(final).not.toBeNull();
    for (const name of TASK_NAMES) {
      expect(final!.lastCheck?.[name]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  }, 30_000);

  it('all 8 agents write files without failures', async () => {
    const state = initSyncState('feature/test', TASK_NAMES, 'fleet.yaml');
    writeSyncState(state, repoDir);

    const results = await Promise.all(TASK_NAMES.map((t) => spawnWorker(repoDir, t, 'write-file')));

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.error('Failures:', failures);
    }
    expect(failures).toHaveLength(0);

    // Verify all 8 files exist in the sync worktree
    for (const name of TASK_NAMES) {
      const content = readSyncFile(`agent-${name}.txt`, repoDir);
      expect(content).toBe(`hello from ${name}\n`);
    }
  }, 30_000);

  it('mixed operations — claims, lastCheck, and file writes — all succeed', async () => {
    const state = initSyncState('feature/test', TASK_NAMES, 'fleet.yaml');
    writeSyncState(state, repoDir);

    // Each agent does a different mix of operations
    const operations: Array<Promise<WorkerResult>> = [];
    for (const name of TASK_NAMES) {
      operations.push(spawnWorker(repoDir, name, 'claim'));
    }
    // Wait for claims to land first — they need pending status
    const claimResults = await Promise.all(operations);

    const claimFailures = claimResults.filter((r) => !r.ok);
    if (claimFailures.length > 0) {
      console.error('Claim failures:', claimFailures);
    }
    expect(claimFailures).toHaveLength(0);

    // Now fire lastCheck + file writes simultaneously (16 concurrent operations)
    const phase2 = await Promise.all([
      ...TASK_NAMES.map((t) => spawnWorker(repoDir, t, 'lastcheck')),
      ...TASK_NAMES.map((t) => spawnWorker(repoDir, t, 'write-file')),
    ]);

    const phase2Failures = phase2.filter((r) => !r.ok);
    if (phase2Failures.length > 0) {
      console.error('Phase 2 failures:', phase2Failures);
    }
    expect(phase2Failures).toHaveLength(0);

    // Verify everything landed
    const final = readSyncState(repoDir);
    for (const name of TASK_NAMES) {
      expect(final!.tasks[name]?.status).toBe('in_progress');
      expect(final!.lastCheck?.[name]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(readSyncFile(`agent-${name}.txt`, repoDir)).toBe(`hello from ${name}\n`);
    }
  }, 60_000);
});
