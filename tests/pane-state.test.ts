import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import {
  readPaneConfig,
  writePaneConfig,
  saveDetachedAgents,
  killDetachedAgents,
  killOrphanedAgentSessions,
} from '../src/lib/pane-state.js';
import type { FleetPaneConfig, DetachedAgent } from '../src/lib/tmux.js';
import { basename } from 'node:path';
import { tmuxSessionName } from '../src/lib/tmux.js';
import { makeTempDir } from './helpers/temp.js';
import { createMockTmux } from './helpers/mock-tmux.js';

describe('pane-state: readPaneConfig / writePaneConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withFleetDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when panes.json does not exist', () => {
    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('round-trips detached mode config', () => {
    const agent: DetachedAgent = {
      id: 'fleet-1',
      sessionName: 'fleet-myapp-auth',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
      branchName: 'feature-auth',
    };
    const config: FleetPaneConfig = {
      mode: 'detached',
      sessionName: 'fleet-myapp',
      repoRoot: '/home/user/myapp',
      detached: [agent],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };
    writePaneConfig(tempDir, config);
    const result = readPaneConfig(tempDir);
    expect(result?.mode).toBe('detached');
    expect(result?.detached).toHaveLength(1);
    expect(result?.detached?.[0]?.sessionName).toBe('fleet-myapp-auth');
  });

  it('overwrites existing config', () => {
    const config1: FleetPaneConfig = {
      mode: 'detached',
      sessionName: 'fleet-myapp',
      repoRoot: '/home/user/myapp',
      detached: [],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    const config2: FleetPaneConfig = {
      mode: 'detached',
      sessionName: 'fleet-myapp',
      repoRoot: '/home/user/myapp',
      detached: [
        {
          id: 'fleet-1',
          sessionName: 'fleet-myapp-auth',
          taskName: 'auth',
          worktreePath: '/tmp/wt-auth',
          branchName: '',
        },
      ],
      lastUpdated: '2026-02-21T01:00:00.000Z',
    };

    writePaneConfig(tempDir, config1);
    writePaneConfig(tempDir, config2);

    const result = readPaneConfig(tempDir);
    expect(result?.detached).toHaveLength(1);
  });
});

describe('pane-state: saveDetachedAgents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withFleetDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves detached agents with mode=detached', () => {
    const agents: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: 'feat-auth',
      },
    ];
    saveDetachedAgents(tempDir, 'fleet-myapp', agents);

    const config = readPaneConfig(tempDir);
    expect(config?.mode).toBe('detached');
    expect(config?.detached).toHaveLength(1);
    expect(config?.detached?.[0]?.sessionName).toBe('fleet-myapp-auth');
  });
});

describe('pane-state: killDetachedAgents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withFleetDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills all detached sessions and clears the array', () => {
    const agents: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
      {
        id: 'fleet-2',
        sessionName: 'fleet-myapp-api',
        taskName: 'api',
        worktreePath: '/tmp/wt-api',
        branchName: '',
      },
    ];
    saveDetachedAgents(tempDir, 'fleet-myapp', agents);

    // Mock: both sessions exist
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.createSession('fleet-myapp-api', '/tmp');
    mock.calls.length = 0;

    killDetachedAgents(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(2);

    const config = readPaneConfig(tempDir);
    expect(config?.detached).toHaveLength(0);
  });

  it('skips sessions that no longer exist', () => {
    const agents: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-gone',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    saveDetachedAgents(tempDir, 'fleet-myapp', agents);

    const mock = createMockTmux();
    // Override sessionExists to return false (session is dead)
    mock.sessionExists = (name: string) => {
      mock.calls.push({ method: 'sessionExists', args: [name] });
      return false;
    };
    killDetachedAgents(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });

  it('does nothing when no panes.json exists', () => {
    const mock = createMockTmux();
    killDetachedAgents(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });
});

describe('pane-state: killOrphanedAgentSessions', () => {
  let tempDir: string;
  let sessionPrefix: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withFleetDir: true });
    sessionPrefix = tmuxSessionName(basename(tempDir));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills untracked sessions matching the repo prefix but preserves tracked ones', () => {
    const tracked: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: `${sessionPrefix}-auth`,
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    saveDetachedAgents(tempDir, sessionPrefix, tracked);

    const mock = createMockTmux();
    mock.createSession(`${sessionPrefix}-auth`, '/tmp');
    mock.createSession(`${sessionPrefix}-old-task`, '/tmp');
    mock.createSession(`${sessionPrefix}-removed`, '/tmp');
    mock.createSession('unrelated-session', '/tmp');
    mock.calls.length = 0;

    killOrphanedAgentSessions(mock, tempDir);

    const killed = mock.calls.filter((c) => c.method === 'killSession').map((c) => c.args[0]);
    expect(killed).toContain(`${sessionPrefix}-old-task`);
    expect(killed).toContain(`${sessionPrefix}-removed`);
    expect(killed).not.toContain(`${sessionPrefix}-auth`);
    expect(killed).not.toContain('unrelated-session');
  });

  it('does not kill the base session itself (requires dash separator)', () => {
    const mock = createMockTmux();
    mock.createSession(sessionPrefix, '/tmp');
    mock.calls.length = 0;

    killOrphanedAgentSessions(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });

  it('kills all matching sessions when no panes.json exists', () => {
    const mock = createMockTmux();
    mock.createSession(`${sessionPrefix}-orphan1`, '/tmp');
    mock.createSession(`${sessionPrefix}-orphan2`, '/tmp');
    mock.calls.length = 0;

    killOrphanedAgentSessions(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(2);
  });

  it('handles empty tmux session list gracefully', () => {
    const mock = createMockTmux();
    killOrphanedAgentSessions(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });
});
