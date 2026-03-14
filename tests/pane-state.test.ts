import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  readPaneConfig,
  writePaneConfig,
  savePanes,
  saveDetachedAgents,
  restorePanes,
  killPanes,
  killDetachedAgents,
  killOrphanedAgentSessions,
} from '../src/lib/pane-state.js';
import type { PawPane, PawPaneConfig, DetachedAgent } from '../src/lib/tmux.js';
import { basename, resolve } from 'node:path';
import { tmuxSessionName } from '../src/lib/tmux.js';
import { makeTempDir } from './helpers/temp.js';
import { createMockTmux } from './helpers/mock-tmux.js';

function makePane(overrides: Partial<PawPane> = {}): PawPane {
  return {
    id: 'paw-1',
    paneId: '%1',
    taskName: 'auth',
    worktreePath: '/tmp/wt-auth',
    branchName: 'feature-auth',
    ...overrides,
  };
}

describe('pane-state: readPaneConfig / writePaneConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when panes.json does not exist', () => {
    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('returns null when panes.json contains corrupt JSON', () => {
    const runDir = resolve(tempDir, '.paw', 'run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, 'panes.json'), '{ invalid');

    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('returns null when panes.json is a truncated file (partial write)', () => {
    const runDir = resolve(tempDir, '.paw', 'run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      resolve(runDir, 'panes.json'),
      '{"sessionName":"paw-myapp","repoRoot":"/home/user/myapp","orchestratorPaneId":"%1","panes":[{"id":"paw-1","paneId":"%1","taskName":"auth","worktreePath":"/tmp/wt-auth","bra',
    );

    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('round-trips pane config through write and read', () => {
    const config: PawPaneConfig = {
      sessionName: 'paw-myapp',
      repoRoot: '/home/user/myapp',
      orchestratorPaneId: '%1',
      panes: [makePane()],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    writePaneConfig(tempDir, config);
    const result = readPaneConfig(tempDir);

    expect(result).toEqual(config);
  });

  it('overwrites existing config', () => {
    const config1: PawPaneConfig = {
      sessionName: 'paw-myapp',
      repoRoot: '/home/user/myapp',
      orchestratorPaneId: '%1',
      panes: [makePane({ id: 'paw-1' })],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    const config2: PawPaneConfig = {
      sessionName: 'paw-myapp',
      repoRoot: '/home/user/myapp',
      orchestratorPaneId: '%1',
      panes: [makePane({ id: 'paw-1' }), makePane({ id: 'paw-2', taskName: 'api' })],
      lastUpdated: '2026-02-21T01:00:00.000Z',
    };

    writePaneConfig(tempDir, config1);
    writePaneConfig(tempDir, config2);

    const result = readPaneConfig(tempDir);
    expect(result?.panes).toHaveLength(2);
  });

  it('reads config without mode field (backward compat)', () => {
    const config: PawPaneConfig = {
      sessionName: 'paw-myapp',
      repoRoot: '/home/user/myapp',
      orchestratorPaneId: '%1',
      panes: [],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };
    writePaneConfig(tempDir, config);
    const result = readPaneConfig(tempDir);
    expect(result?.mode).toBeUndefined();
  });

  it('round-trips detached mode config', () => {
    const agent: DetachedAgent = {
      id: 'paw-1',
      sessionName: 'paw-myapp-auth',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
      branchName: 'feature-auth',
    };
    const config: PawPaneConfig = {
      mode: 'detached',
      sessionName: 'paw-myapp',
      repoRoot: '/home/user/myapp',
      orchestratorPaneId: '',
      panes: [],
      detached: [agent],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };
    writePaneConfig(tempDir, config);
    const result = readPaneConfig(tempDir);
    expect(result?.mode).toBe('detached');
    expect(result?.detached).toHaveLength(1);
    expect(result?.detached?.[0]?.sessionName).toBe('paw-myapp-auth');
  });
});

describe('pane-state: savePanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves panes and orchestratorPaneId with session info', () => {
    const panes = [makePane()];
    savePanes(tempDir, 'paw-myapp', panes, '%1');

    const config = readPaneConfig(tempDir);
    expect(config?.sessionName).toBe('paw-myapp');
    expect(config?.orchestratorPaneId).toBe('%1');
    expect(config?.panes).toEqual(panes);
    expect(new Date(config!.lastUpdated).getTime()).not.toBeNaN();
  });

  it('saves empty orchestratorPaneId when not yet created', () => {
    savePanes(tempDir, 'paw-myapp', [], '');

    const config = readPaneConfig(tempDir);
    expect(config?.orchestratorPaneId).toBe('');
  });
});

describe('pane-state: restorePanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty result when no config exists', () => {
    const mock = createMockTmux();
    const result = restorePanes(mock, 'paw-myapp', tempDir);
    expect(result.panes).toEqual([]);
    expect(result.orchestratorPaneId).toBe('');
  });

  it('adopts surviving orchestrator by title when panes.json is absent', () => {
    const titleMap = new Map([['paw-orchestrator', '%3']]);
    const mock = createMockTmux({ existingPanes: ['%3'], titleMap });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.orchestratorPaneId).toBe('%3');
    expect(result.panes).toHaveLength(0);

    // Should have written panes.json so next run finds it by ID
    const config = readPaneConfig(tempDir);
    expect(config?.orchestratorPaneId).toBe('%3');
  });

  it('keeps task panes that still exist in tmux', () => {
    const pane = makePane({ paneId: '%5' });
    savePanes(tempDir, 'paw-myapp', [pane], '%1');

    const mock = createMockTmux({ existingPanes: ['%1', '%5'] });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.panes).toHaveLength(1);
    expect(result.panes[0]!.paneId).toBe('%5');
    expect(result.orchestratorPaneId).toBe('%1');
  });

  it('drops dead task panes instead of recreating empty shells', () => {
    const pane = makePane({ paneId: '%99', worktreePath: tempDir });
    savePanes(tempDir, 'paw-myapp', [pane], '');

    const mock = createMockTmux({ existingPanes: [] });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    // Dead pane is dropped — user must `paw launch` to bring it back with an agent
    expect(result.panes).toHaveLength(0);

    const createCall = mock.calls.find((c) => c.method === 'createPane');
    expect(createCall).toBeUndefined();
  });

  it('rebinds task pane by title when pane ID is gone but title exists', () => {
    const pane = makePane({ paneId: '%99', taskName: 'auth', worktreePath: tempDir });
    savePanes(tempDir, 'paw-myapp', [pane], '');

    const titles = new Map([['paw-auth', '%50']]);
    const mock = createMockTmux({ existingPanes: [], titleMap: titles });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.panes).toHaveLength(1);
    expect(result.panes[0]!.paneId).toBe('%50');

    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(0);
  });

  it('skips recreating task panes when worktree is gone', () => {
    const pane = makePane({ paneId: '%99', worktreePath: '/nonexistent/path' });
    savePanes(tempDir, 'paw-myapp', [pane], '');

    const mock = createMockTmux({ existingPanes: [] });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.panes).toHaveLength(0);
  });

  it('recreates orchestrator pane when tracked pane is gone', () => {
    savePanes(tempDir, 'paw-myapp', [], '%55');

    const mock = createMockTmux({ existingPanes: [] }); // %55 not in session
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.orchestratorPaneId).toBe('%101');

    const createCall = mock.calls.find((c) => c.method === 'createPane');
    expect(createCall).toBeDefined();

    const titleCall = mock.calls.find(
      (c) => c.method === 'setPaneTitle' && c.args[1] === 'paw-orchestrator',
    );
    expect(titleCall).toBeDefined();
  });

  it('keeps orchestrator pane when it still exists', () => {
    savePanes(tempDir, 'paw-myapp', [], '%55');

    const mock = createMockTmux({ existingPanes: ['%55'] });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.orchestratorPaneId).toBe('%55');

    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(0);
  });

  it('returns empty orchestratorPaneId when none was tracked', () => {
    savePanes(tempDir, 'paw-myapp', [], '');

    const mock = createMockTmux({ existingPanes: [] });
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result.orchestratorPaneId).toBe('');

    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(0);
  });
});

describe('pane-state: killPanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills all task panes and clears panes array; preserves orchestratorPaneId', () => {
    const panes = [
      makePane({ paneId: '%1', taskName: 'auth' }),
      makePane({ paneId: '%2', taskName: 'api', id: 'paw-2' }),
      makePane({ paneId: '%3', taskName: 'tests', id: 'paw-3' }),
    ];
    savePanes(tempDir, 'paw-myapp', panes, '%0');

    const mock = createMockTmux({ existingPanes: ['%0', '%1', '%2', '%3'] });
    killPanes(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killPane');
    expect(killCalls).toHaveLength(3);
    expect(killCalls.map((c) => c.args[0])).not.toContain('%0'); // orchestrator preserved
    expect(killCalls.map((c) => c.args[0])).toContain('%1');

    // panes.json survives with empty task list so next `paw` run finds the orchestrator
    const config = readPaneConfig(tempDir);
    expect(config).not.toBeNull();
    expect(config!.panes).toHaveLength(0);
    expect(config!.orchestratorPaneId).toBe('%0');
  });

  it('skips panes that no longer exist in tmux', () => {
    const panes = [
      makePane({ paneId: '%1', taskName: 'auth' }),
      makePane({ paneId: '%2', taskName: 'api', id: 'paw-2' }),
    ];
    savePanes(tempDir, 'paw-myapp', panes, '%0');

    const mock = createMockTmux({ existingPanes: ['%1'] }); // %0 and %2 gone
    killPanes(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killPane');
    expect(killCalls).toHaveLength(1);
    expect(killCalls[0]!.args[0]).toBe('%1');
  });

  it('does nothing when no panes.json exists', () => {
    const mock = createMockTmux();
    killPanes(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killPane');
    expect(killCalls).toHaveLength(0);
  });
});

describe('pane-state: saveDetachedAgents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves detached agents with mode=detached', () => {
    const agents: DetachedAgent[] = [
      {
        id: 'paw-1',
        sessionName: 'paw-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: 'feat-auth',
      },
    ];
    saveDetachedAgents(tempDir, 'paw-myapp', agents);

    const config = readPaneConfig(tempDir);
    expect(config?.mode).toBe('detached');
    expect(config?.detached).toHaveLength(1);
    expect(config?.detached?.[0]?.sessionName).toBe('paw-myapp-auth');
    expect(config?.panes).toHaveLength(0);
    expect(config?.orchestratorPaneId).toBe('');
  });
});

describe('pane-state: killDetachedAgents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir({ withPawDir: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills all detached sessions and clears the array', () => {
    const agents: DetachedAgent[] = [
      {
        id: 'paw-1',
        sessionName: 'paw-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
      {
        id: 'paw-2',
        sessionName: 'paw-myapp-api',
        taskName: 'api',
        worktreePath: '/tmp/wt-api',
        branchName: '',
      },
    ];
    saveDetachedAgents(tempDir, 'paw-myapp', agents);

    // Mock: both sessions exist
    const mock = createMockTmux();
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.createSession('paw-myapp-api', '/tmp');
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
        id: 'paw-1',
        sessionName: 'paw-myapp-gone',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    saveDetachedAgents(tempDir, 'paw-myapp', agents);

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
    tempDir = makeTempDir({ withPawDir: true });
    sessionPrefix = tmuxSessionName(basename(tempDir));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills untracked sessions matching the repo prefix but preserves tracked ones', () => {
    const tracked: DetachedAgent[] = [
      {
        id: 'paw-1',
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
