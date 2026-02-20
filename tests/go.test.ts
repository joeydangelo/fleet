import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing go.ts
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock lib modules
vi.mock('../src/lib/git.js', () => ({
  getRepoRoot: vi.fn(() => '/fake/repo'),
  getCurrentBranch: vi.fn(() => 'feature/x'),
  git: vi.fn(),
  getCommitCount: vi.fn(() => 3),
  getChangedFileCount: vi.fn(() => 5),
}));

vi.mock('../src/lib/config.js', () => ({
  loadConfig: vi.fn(() => ({
    base: 'main',
    target: 'feature/x',
    agent: 'claude',
    tasks: { auth: { focus: 'src/auth/' }, api: { focus: 'src/api/' } },
  })),
  resolveConfigPath: vi.fn(() => '/fake/repo/.paw/paw.yaml'),
}));

vi.mock('../src/lib/session.js', () => ({
  planWorktrees: vi.fn(() => [
    { taskName: 'auth', branch: 'feature/x-auth', worktreePath: '/fake/repo-paw-auth' },
    { taskName: 'api', branch: 'feature/x-api', worktreePath: '/fake/repo-paw-api' },
  ]),
}));

vi.mock('../src/lib/sync.js', () => ({
  readSyncState: vi.fn(() => null),
}));

vi.mock('../src/lib/journal.js', () => ({
  readJournal: vi.fn(() => []),
}));

import { execFileSync } from 'node:child_process';
import { readSyncState } from '../src/lib/sync.js';
import { loadConfig } from '../src/lib/config.js';
import { runPawCommand, runGo } from '../src/commands/go.js';
import * as watchModule from '../src/commands/watch.js';
import { runWatchLoop } from '../src/commands/watch.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockReadSyncState = vi.mocked(readSyncState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPawCommand', () => {
  it('returns exitCode 0 on success', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    const result = runPawCommand(['up']);
    expect(result.exitCode).toBe(0);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns non-zero exitCode on failure', () => {
    const err = new Error('command failed') as Error & { status: number };
    err.status = 1;
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = runPawCommand(['merge']);
    expect(result.exitCode).toBe(1);
  });

  it('passes config args through to the subcommand', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    runPawCommand(['up', '-c', '/custom/path.yaml']);
    const call = mockExecFileSync.mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).toContain('up');
    expect(args).toContain('-c');
    expect(args).toContain('/custom/path.yaml');
  });
});

describe('go: merge conflict stops without teardown', () => {
  it('does not call paw down when merge returns non-zero', () => {
    const callOrder: string[] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const subcommand = (args as string[])[1]!;
      callOrder.push(subcommand);
      if (subcommand === 'merge') {
        const err = new Error('conflict') as Error & { status: number };
        err.status = 1;
        throw err;
      }
      return Buffer.from('');
    });

    runPawCommand(['up']);
    runPawCommand(['launch']);
    const mergeResult = runPawCommand(['merge']);

    // Merge failed -- do NOT call down
    expect(mergeResult.exitCode).toBe(1);
    expect(callOrder).toEqual(['up', 'launch', 'merge']);
    expect(callOrder).not.toContain('down');
  });
});

describe('runWatchLoop', () => {
  it('exits immediately when all tasks are done', async () => {
    mockReadSyncState.mockReturnValue({
      session: 'test',
      config: '/fake/config',
      target: 'feature/x',
      tasks: {
        auth: { status: 'done', doneAt: '2026-02-15T00:00:00Z' },
        api: { status: 'done', doneAt: '2026-02-15T00:01:00Z' },
      },
    });

    await runWatchLoop({
      repoRoot: '/fake/repo',
      configPath: '/fake/repo/.paw/paw.yaml',
      interval: 1,
      noExit: false,
    });

    // If we got here without hanging, the watch loop detected all done and exited
    expect(mockReadSyncState).toHaveBeenCalled();
  });

  it('polls until all tasks complete', async () => {
    let callCount = 0;
    mockReadSyncState.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return {
          session: 'test',
          config: '/fake/config',
          target: 'feature/x',
          tasks: {
            auth: { status: 'done' as const, doneAt: '2026-02-15T00:00:00Z' },
            api: { status: 'in_progress' as const, claimed: '2026-02-15T00:00:00Z' },
          },
        };
      }
      return {
        session: 'test',
        config: '/fake/config',
        target: 'feature/x',
        tasks: {
          auth: { status: 'done' as const, doneAt: '2026-02-15T00:00:00Z' },
          api: { status: 'done' as const, doneAt: '2026-02-15T00:01:00Z' },
        },
      };
    });

    await runWatchLoop({
      repoRoot: '/fake/repo',
      configPath: '/fake/repo/.paw/paw.yaml',
      interval: 0.01, // very short for testing
      noExit: false,
    });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});

describe('runGo: merge failure message (paw-lk9k)', () => {
  const mockLoadConfig = vi.mocked(loadConfig);

  beforeEach(() => {
    // Make up and launch succeed, merge fail
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const subcommand = (args as string[])[1];
      if (subcommand === 'merge') {
        const err = new Error('merge failed') as Error & { status: number };
        err.status = 1;
        throw err;
      }
      return Buffer.from('');
    });

    // Mock runWatchLoop to resolve immediately for runGo tests
    vi.spyOn(watchModule, 'runWatchLoop').mockResolvedValue(undefined);
  });

  it('shows manual resolve message when merge fails', async () => {
    mockLoadConfig.mockReturnValueOnce({
      base: 'main',
      target: 'feature/x',
      agent: 'claude',
      tasks: { auth: { focus: 'src/auth/' }, api: { focus: 'src/api/' } },
    });

    await runGo({ pollInterval: '5' });

    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    const hasManualMsg = logs.some((msg) => msg.includes('Merge failed'));
    expect(hasManualMsg).toBe(true);
  });
});
