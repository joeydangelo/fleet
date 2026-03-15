import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncState } from '../src/lib/sync.js';
import type { FleetPaneConfig } from '../src/lib/tmux.js';
import type { AgentLivenessResult } from '../src/lib/tmux.js';
import { resolveSessionState } from '../src/commands/go.js';

// Mock child_process — runFleetCommand tests need this; integration tests restore real impl via vi.importActual
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock only createTmuxService (external boundary)
vi.mock('../src/lib/tmux.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, createTmuxService: vi.fn() };
});

import { execFileSync } from 'node:child_process';
import { runFleetCommand, runGo } from '../src/commands/go.js';
import { createFixtureRepo } from './helpers/fixture-repo.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('runFleetCommand', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns exitCode 0 on success', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    const result = runFleetCommand(['up']);
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exitCode on failure', () => {
    const err = new Error('command failed') as Error & { status: number };
    err.status = 1;
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = runFleetCommand(['merge']);
    expect(result.exitCode).toBe(1);
  });

  it('passes args through to the subcommand', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    runFleetCommand(['up', '--dry-run']);
    const call = mockExecFileSync.mock.calls[0]!;
    const args = call[1] as string[];
    expect(args).toContain('up');
    expect(args).toContain('--dry-run');
  });
});

describe('runGo dry-run integration', () => {
  let cleanup: () => void;
  let repoRoot: string;
  let savedCwd: string;

  beforeEach(async () => {
    savedCwd = process.cwd();
    // Restore real execFileSync so git operations work in the integration test
    const actualCp: Record<string, unknown> = await vi.importActual('node:child_process');
    mockExecFileSync.mockImplementation(actualCp.execFileSync as typeof execFileSync);

    const fixture = createFixtureRepo({
      tasks: {
        auth: { focus: 'src/auth/' },
        api: { focus: 'src/api/' },
      },
      syncState: {
        tasks: {
          auth: { status: 'pending' },
          api: { status: 'pending' },
        },
      },
    });
    repoRoot = fixture.repoRoot;
    cleanup = fixture.cleanup;

    process.chdir(repoRoot);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(savedCwd);
    cleanup();
    vi.restoreAllMocks();
  });

  it('prints task count, target branch, and worktree paths', async () => {
    await runGo({ dryRun: true });

    const logs = vi.mocked(console.log).mock.calls.map((c) => c.map(String).join(' '));
    const output = logs.join('\n');

    // Verify task count
    expect(output).toContain('tasks:   2');
    // Verify target branch
    expect(output).toContain('target:  fix/test-target');
    // Verify worktree paths appear (planWorktrees generates sibling-directory paths)
    expect(output).toMatch(/fleet-auth/);
    expect(output).toMatch(/fleet-api/);
  });
});

describe('resolveSessionState', () => {
  const baseSyncState: SyncState = {
    session: '2026-02-25T00:00:00Z',
    config: '/fake/config',
    target: 'feature/x',
    tasks: {},
    merges: {},
    lastCheck: {},
  };

  const basePaneConfig: FleetPaneConfig = {
    mode: 'detached',
    sessionName: 'fleet-test',
    repoRoot: '/fake/repo',
    orchestratorPaneId: '',
    panes: [],
    detached: [
      {
        id: 'fleet-1',
        sessionName: 'fleet-test-auth',
        taskName: 'auth',
        worktreePath: '/fake/repo-fleet-auth',
        branchName: 'feature/x-auth',
      },
      {
        id: 'fleet-2',
        sessionName: 'fleet-test-api',
        taskName: 'api',
        worktreePath: '/fake/repo-fleet-api',
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
