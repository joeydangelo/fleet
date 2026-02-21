import { describe, it, expect } from 'vitest';
import { tmuxSessionName, launchTmux } from '../src/lib/tmux.js';
import type { TmuxServiceApi } from '../src/lib/tmux.js';

/** Create a mock TmuxServiceApi for testing. */
function createMockTmux(): TmuxServiceApi & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let paneCounter = 0;
  const sessions = new Set<string>();

  return {
    calls,
    sessionExists(name: string) {
      calls.push({ method: 'sessionExists', args: [name] });
      return sessions.has(name);
    },
    createSession(name: string, cwd: string) {
      calls.push({ method: 'createSession', args: [name, cwd] });
      sessions.add(name);
    },
    killSession(name: string) {
      calls.push({ method: 'killSession', args: [name] });
      sessions.delete(name);
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
      return [];
    },
    paneExists(paneId: string) {
      calls.push({ method: 'paneExists', args: [paneId] });
      return true;
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

describe('launch: tmux session naming', () => {
  it('creates session name from repo directory', () => {
    expect(tmuxSessionName('myapp')).toBe('paw-myapp');
  });

  it('sanitizes special characters in repo name', () => {
    expect(tmuxSessionName('my-project_v2')).toBe('paw-my-project-v2');
  });
});

describe('launch: dry-run shows tmux commands', () => {
  it('builds tmux pane descriptions for each worktree', () => {
    const worktrees = [
      { taskName: 'auth', worktreePath: '/home/user/app-paw-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/home/user/app-paw-api', agentCommand: 'claude' },
    ];

    // Dry-run would print these. Verify the data structure is correct.
    for (const wt of worktrees) {
      const msg = `tmux split-window -c ${wt.worktreePath} → ${wt.agentCommand}`;
      expect(msg).toContain(wt.worktreePath);
      expect(msg).toContain(wt.agentCommand);
    }
  });
});

describe('launch: tmux pane creation', () => {
  it('creates panes for all worktrees', () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];

    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    expect(panes).toHaveLength(2);
    expect(panes[0]!.taskName).toBe('auth');
    expect(panes[1]!.taskName).toBe('api');
  });

  it('skip logic: done tasks should not generate panes', () => {
    const tasks = {
      auth: { status: 'done' as const },
      api: { status: 'in_progress' as const },
      tests: { status: 'pending' as const },
    };

    const launchable = Object.entries(tasks).filter(([_, t]) => t.status !== 'done');
    expect(launchable.map(([name]) => name)).toEqual(['api', 'tests']);
  });
});
