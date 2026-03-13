import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncState } from '../src/lib/sync.js';
import type { PawPaneConfig } from '../src/lib/tmux.js';
import type { AgentLivenessResult } from '../src/lib/tmux.js';
import { resolveSessionState } from '../src/commands/go.js';

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
  createSession: vi.fn(() => [
    { taskName: 'auth', branch: 'feature/x-auth', worktreePath: '/fake/repo-paw-auth' },
    { taskName: 'api', branch: 'feature/x-api', worktreePath: '/fake/repo-paw-api' },
  ]),
  writeTaskFiles: vi.fn(),
  copyIncludes: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../src/lib/sync.js', () => ({
  isTerminalStatus: (status: string) => status === 'done',
  readSyncState: vi.fn(() => null),
  writeSyncState: vi.fn(),
  initSyncWorktree: vi.fn(),
  initSyncState: vi.fn(() => ({
    session: 'test',
    config: '/fake/config',
    target: 'feature/x',
    tasks: {},
  })),
  writeSyncStateAndFiles: vi.fn(),
}));

vi.mock('../src/lib/pane-state.js', () => ({
  readPaneConfig: vi.fn(() => null),
  saveDetachedAgents: vi.fn(),
  savePanes: vi.fn(),
  resolvePaneTarget: vi.fn(() => null),
}));

vi.mock('../src/lib/health.js', () => ({
  evaluateAllAgents: vi.fn(({ taskNames }: { taskNames: string[] }) => ({
    timestamp: new Date().toISOString(),
    agents: Object.fromEntries(
      taskNames.map((t: string) => [
        t,
        {
          taskName: t,
          state: 'booting',
          lastActivity: null,
          stalledSince: null,
          escalationLevel: 0,
        },
      ]),
    ),
  })),
  writeNudge: vi.fn(),
  writeHealthSnapshot: vi.fn(),
  triageAgent: vi.fn(() => ({ verdict: 'extend', captured: '' })),
  saveTriageOutput: vi.fn(),
}));

vi.mock('../src/lib/tmux.js', async () => {
  const actual = await vi.importActual('../src/lib/tmux.js');
  return {
    ...actual,
    createTmuxService: vi.fn(),
    checkAgentLiveness: vi.fn(() => []),
    ensureTmuxInstalled: vi.fn(),
    tmuxSessionName: vi.fn(() => 'paw-test'),
    isInsideTmux: vi.fn(() => false),
    launchDetached: vi.fn(() => Promise.resolve([])),
    launchTmux: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('../src/lib/messages.js', () => ({
  readMessages: vi.fn(() => []),
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

  it('passes args through to the subcommand', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    runPawCommand(['up', '--dry-run']);
    const call = mockExecFileSync.mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).toContain('up');
    expect(args).toContain('--dry-run');
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

    await runGo({});

    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    const hasManualMsg = logs.some((msg) => msg.includes('Merge failed'));
    expect(hasManualMsg).toBe(true);
  });
});

describe('resolveSessionState', () => {
  const baseSyncState: SyncState = {
    session: '2026-02-25T00:00:00Z',
    config: '/fake/config',
    target: 'feature/x',
    tasks: {},
  };

  const basePaneConfig: PawPaneConfig = {
    mode: 'detached',
    sessionName: 'paw-test',
    projectRoot: '/fake/repo',
    orchestratorPaneId: '',
    panes: [],
    detached: [
      {
        id: 'paw-1',
        sessionName: 'paw-test-auth',
        taskName: 'auth',
        worktreePath: '/fake/repo-paw-auth',
        agent: 'claude',
        branchName: 'feature/x-auth',
      },
      {
        id: 'paw-2',
        sessionName: 'paw-test-api',
        taskName: 'api',
        worktreePath: '/fake/repo-paw-api',
        agent: 'claude',
        branchName: 'feature/x-api',
      },
    ],
    lastUpdated: '2026-02-25T00:00:00Z',
  };

  it('returns no-session when sync state is null', () => {
    expect(resolveSessionState(null, null, null)).toBe('no-session');
  });

  it('returns clean when sync state has no tasks', () => {
    expect(resolveSessionState(baseSyncState, null, null)).toBe('clean');
  });

  it('returns all-done when every task is done', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'done', doneAt: '2026-02-25T00:01:00Z' },
        api: { status: 'done', doneAt: '2026-02-25T00:02:00Z' },
      },
    };
    expect(resolveSessionState(state, basePaneConfig, [])).toBe('all-done');
  });

  it('returns no-session when pane config is missing but tasks are not done', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_progress' },
        api: { status: 'pending' },
      },
    };
    expect(resolveSessionState(state, null, null)).toBe('no-session');
  });

  it('returns agents-running when all non-done agents are alive', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_progress' },
        api: { status: 'in_progress' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: true },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('agents-running');
  });

  it('returns has-dead-agents when some non-done agents are dead', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_progress' },
        api: { status: 'in_progress' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: false },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('has-dead-agents');
  });

  it('returns all-done when only done tasks remain and dead agents are done', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'done', doneAt: '2026-02-25T00:01:00Z' },
        api: { status: 'done', doneAt: '2026-02-25T00:02:00Z' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: false },
      { taskName: 'api', alive: false },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('all-done');
  });

  it('returns agents-running when one task is done and the other is alive', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'done', doneAt: '2026-02-25T00:01:00Z' },
        api: { status: 'in_progress' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: false },
      { taskName: 'api', alive: true },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('agents-running');
  });

  it('returns no-session when liveness is null (tmux unavailable)', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_progress' },
      },
    };
    expect(resolveSessionState(state, basePaneConfig, null)).toBe('no-session');
  });

  it('returns agents-running when all tasks are in_review (agents still active)', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_review' },
        api: { status: 'in_review' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: true },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('agents-running');
  });

  it('returns agents-running when tasks are a mix of done and in_review with alive agents', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'done', doneAt: '2026-02-25T00:01:00Z' },
        api: { status: 'in_review' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: false },
      { taskName: 'api', alive: true },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('agents-running');
  });

  it('includes in_review tasks in liveness checks (agents are active during review)', () => {
    const state: SyncState = {
      ...baseSyncState,
      tasks: {
        auth: { status: 'in_review' },
        api: { status: 'in_progress' },
      },
    };
    const liveness: AgentLivenessResult[] = [
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: true },
    ];
    expect(resolveSessionState(state, basePaneConfig, liveness)).toBe('agents-running');
  });
});
