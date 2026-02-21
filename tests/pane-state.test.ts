import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readPaneConfig,
  writePaneConfig,
  savePanes,
  restorePanes,
  killPanes,
} from '../src/lib/pane-state.js';
import type { PawPane, PawPaneConfig, TmuxServiceApi } from '../src/lib/tmux.js';

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-pane-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(resolve(dir, '.paw'), { recursive: true });
  return dir;
}

function createMockTmux(
  existingPanes: string[] = [],
  titleMap: Map<string, string> = new Map(),
): TmuxServiceApi & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let paneCounter = 100;

  return {
    calls,
    sessionExists(name: string) {
      calls.push({ method: 'sessionExists', args: [name] });
      return true;
    },
    createSession(name: string, cwd: string) {
      calls.push({ method: 'createSession', args: [name, cwd] });
    },
    killSession(name: string) {
      calls.push({ method: 'killSession', args: [name] });
    },
    createPane(sessionName: string, cwd: string) {
      calls.push({ method: 'createPane', args: [sessionName, cwd] });
      paneCounter++;
      return `%${paneCounter}`;
    },
    killPane(paneId: string) {
      calls.push({ method: 'killPane', args: [paneId] });
    },
    listPanes(sessionName: string) {
      calls.push({ method: 'listPanes', args: [sessionName] });
      return existingPanes;
    },
    listPanesWithTitles(sessionName: string) {
      calls.push({ method: 'listPanesWithTitles', args: [sessionName] });
      return titleMap;
    },
    paneExists(paneId: string) {
      calls.push({ method: 'paneExists', args: [paneId] });
      return existingPanes.includes(paneId);
    },
    sendKeys(paneId: string, keys: string) {
      calls.push({ method: 'sendKeys', args: [paneId, keys] });
    },
    capturePane(paneId: string, lines?: number) {
      calls.push({ method: 'capturePane', args: [paneId, lines] });
      return '';
    },
    selectLayout(sessionName: string, layout: string) {
      calls.push({ method: 'selectLayout', args: [sessionName, layout] });
    },
    setPaneTitle(paneId: string, title: string) {
      calls.push({ method: 'setPaneTitle', args: [paneId, title] });
    },
    listClients() {
      calls.push({ method: 'listClients', args: [] });
      return [];
    },
    hasAttachedClient(sessionName: string) {
      calls.push({ method: 'hasAttachedClient', args: [sessionName] });
      return false;
    },
    switchClient(sessionName: string) {
      calls.push({ method: 'switchClient', args: [sessionName] });
    },
    attachSession(sessionName: string) {
      calls.push({ method: 'attachSession', args: [sessionName] });
    },
  };
}

function makePane(overrides: Partial<PawPane> = {}): PawPane {
  return {
    id: 'paw-1',
    paneId: '%1',
    taskName: 'auth',
    prompt: 'claude',
    worktreePath: '/tmp/wt-auth',
    agent: 'claude',
    branchName: 'feature-auth',
    ...overrides,
  };
}

describe('pane-state: readPaneConfig / writePaneConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when panes.json does not exist', () => {
    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('round-trips pane config through write and read', () => {
    const config: PawPaneConfig = {
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      panes: [makePane()],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    writePaneConfig(tempDir, config);
    const result = readPaneConfig(tempDir);

    expect(result).toEqual(config);
  });

  it('writes atomically (file exists after write)', () => {
    const config: PawPaneConfig = {
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      panes: [],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    writePaneConfig(tempDir, config);
    const filePath = resolve(tempDir, '.paw', 'panes.json');
    expect(existsSync(filePath)).toBe(true);

    // Content should be valid JSON
    const content = readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(content) as unknown).not.toThrow();
  });

  it('overwrites existing config', () => {
    const config1: PawPaneConfig = {
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      panes: [makePane({ id: 'paw-1' })],
      lastUpdated: '2026-02-21T00:00:00.000Z',
    };

    const config2: PawPaneConfig = {
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      panes: [makePane({ id: 'paw-1' }), makePane({ id: 'paw-2', taskName: 'api' })],
      lastUpdated: '2026-02-21T01:00:00.000Z',
    };

    writePaneConfig(tempDir, config1);
    writePaneConfig(tempDir, config2);

    const result = readPaneConfig(tempDir);
    expect(result?.panes).toHaveLength(2);
  });
});

describe('pane-state: savePanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves panes with session info', () => {
    const panes = [makePane()];
    savePanes(tempDir, 'paw-myapp', panes);

    const config = readPaneConfig(tempDir);
    expect(config?.sessionName).toBe('paw-myapp');
    expect(config?.panes).toEqual(panes);
    expect(config?.lastUpdated).toBeDefined();
  });
});

describe('pane-state: restorePanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when no config exists', () => {
    const mock = createMockTmux();
    const result = restorePanes(mock, 'paw-myapp', tempDir);
    expect(result).toEqual([]);
  });

  it('keeps panes that still exist in tmux', () => {
    const pane = makePane({ paneId: '%5' });
    savePanes(tempDir, 'paw-myapp', [pane]);

    const mock = createMockTmux(['%5']);
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.paneId).toBe('%5');
  });

  it('recreates missing panes when worktree exists', () => {
    // Use tempDir itself as a worktree path (it exists)
    const pane = makePane({ paneId: '%99', worktreePath: tempDir });
    savePanes(tempDir, 'paw-myapp', [pane]);

    const mock = createMockTmux([]); // No existing panes
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result).toHaveLength(1);
    // New pane ID from mock (starts at %101)
    expect(result[0]!.paneId).toBe('%101');

    // Should have called createPane
    const createCall = mock.calls.find((c) => c.method === 'createPane');
    expect(createCall).toBeDefined();
  });

  it('rebinds pane by title when pane ID is gone but title exists', () => {
    const pane = makePane({ paneId: '%99', taskName: 'auth', worktreePath: tempDir });
    savePanes(tempDir, 'paw-myapp', [pane]);

    const titles = new Map([['paw-auth', '%50']]);
    const mock = createMockTmux([], titles);
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result).toHaveLength(1);
    expect(result[0]!.paneId).toBe('%50');

    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(0);
  });

  it('skips recreating panes when worktree is gone', () => {
    const pane = makePane({ paneId: '%99', worktreePath: '/nonexistent/path' });
    savePanes(tempDir, 'paw-myapp', [pane]);

    const mock = createMockTmux([]);
    const result = restorePanes(mock, 'paw-myapp', tempDir);

    expect(result).toHaveLength(0);
  });
});

describe('pane-state: killPanes', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('kills all persisted panes and removes panes.json', () => {
    const panes = [
      makePane({ paneId: '%1', taskName: 'auth' }),
      makePane({ paneId: '%2', taskName: 'api', id: 'paw-2' }),
      makePane({ paneId: '%3', taskName: 'tests', id: 'paw-3' }),
    ];
    savePanes(tempDir, 'paw-myapp', panes);

    const mock = createMockTmux(['%1', '%2', '%3']);
    killPanes(mock, tempDir);

    const killCalls = mock.calls.filter((c) => c.method === 'killPane');
    expect(killCalls).toHaveLength(3);
    expect(killCalls.map((c) => c.args[0])).toEqual(['%1', '%2', '%3']);

    expect(readPaneConfig(tempDir)).toBeNull();
  });

  it('skips panes that no longer exist in tmux', () => {
    const panes = [
      makePane({ paneId: '%1', taskName: 'auth' }),
      makePane({ paneId: '%2', taskName: 'api', id: 'paw-2' }),
    ];
    savePanes(tempDir, 'paw-myapp', panes);

    const mock = createMockTmux(['%1']); // only %1 exists
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
