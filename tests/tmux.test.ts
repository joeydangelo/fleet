import { describe, it, expect, beforeEach } from 'vitest';
import {
  TmuxService,
  tmuxSessionName,
  cleanAgentEnv,
  isInsideTmux,
  attachToTmuxSession,
  launchTmux,
} from '../src/lib/tmux.js';
import type { TmuxServiceApi, PawPane } from '../src/lib/tmux.js';

// --- Mock TmuxService for unit tests ---

function createMockExec(responses?: Map<string, string>) {
  const calls: string[][] = [];
  const fn = (args: string[], _opts?: { encoding?: string; stdio?: string }) => {
    calls.push(args);
    const key = args.join(' ');
    if (responses?.has(key)) {
      return responses.get(key)!;
    }
    // Default: return empty string for most commands
    return '';
  };
  return { fn, calls };
}

function createMockTmux(): TmuxServiceApi & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let paneCounter = 0;
  const sessions = new Set<string>();

  return {
    calls,
    selectPane(paneId: string) {
      calls.push({ method: 'selectPane', args: [paneId] });
    },
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
    createPane(sessionName: string, cwd: string, opts?: { horizontal?: boolean }) {
      calls.push({ method: 'createPane', args: [sessionName, cwd, opts] });
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
    listPanesDetailed(sessionName: string) {
      calls.push({ method: 'listPanesDetailed', args: [sessionName] });
      return [];
    },
    listPanesWithTitles(sessionName: string) {
      calls.push({ method: 'listPanesWithTitles', args: [sessionName] });
      return new Map<string, string>();
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
    setPaneRole(paneId: string, role: string) {
      calls.push({ method: 'setPaneRole', args: [paneId, role] });
    },
    listClients() {
      calls.push({ method: 'listClients', args: [] });
      return [];
    },
    hasAttachedClient(sessionName: string) {
      calls.push({ method: 'hasAttachedClient', args: [sessionName] });
      return false;
    },
    getCurrentPaneId() {
      calls.push({ method: 'getCurrentPaneId', args: [] });
      return '%0';
    },
    getCurrentSessionName() {
      calls.push({ method: 'getCurrentSessionName', args: [] });
      return 'paw-myapp';
    },
    getPaneCurrentCommand(paneId: string) {
      calls.push({ method: 'getPaneCurrentCommand', args: [paneId] });
      return 'bash';
    },
    resizePane(paneId: string, width: number) {
      calls.push({ method: 'resizePane', args: [paneId, width] });
    },
    pinSidebarLayout(sessionName: string, width: number) {
      calls.push({ method: 'pinSidebarLayout', args: [sessionName, width] });
    },
    switchClient(sessionName: string) {
      calls.push({ method: 'switchClient', args: [sessionName] });
    },
    attachSession(sessionName: string) {
      calls.push({ method: 'attachSession', args: [sessionName] });
    },
  };
}

describe('tmuxSessionName', () => {
  it('sanitizes a simple directory name', () => {
    expect(tmuxSessionName('myapp')).toBe('paw-myapp');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(tmuxSessionName('my_app.v2')).toBe('paw-my-app-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(tmuxSessionName('my---app')).toBe('paw-my-app');
  });

  it('strips leading and trailing hyphens from the sanitized part', () => {
    expect(tmuxSessionName('-myapp-')).toBe('paw-myapp');
  });

  it('handles directories with spaces', () => {
    expect(tmuxSessionName('my app')).toBe('paw-my-app');
  });

  it('handles complex directory names', () => {
    expect(tmuxSessionName('My Project (v2.1)')).toBe('paw-My-Project-v2-1');
  });
});

describe('cleanAgentEnv', () => {
  it('strips CLAUDECODE and CLAUDE_CODE_ENTRYPOINT', () => {
    const env = {
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      HOME: '/home/user',
    };
    const cleaned = cleanAgentEnv(env);
    expect(cleaned).not.toHaveProperty('CLAUDECODE');
    expect(cleaned).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
    expect(cleaned['PATH']).toBe('/usr/bin');
    expect(cleaned['HOME']).toBe('/home/user');
  });

  it('returns env unchanged when no agent vars present', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user' };
    const cleaned = cleanAgentEnv(env);
    expect(cleaned).toEqual(env);
  });

  it('does not mutate the original env', () => {
    const env = { PATH: '/usr/bin', CLAUDECODE: '1' };
    cleanAgentEnv(env);
    expect(env).toHaveProperty('CLAUDECODE');
  });
});

describe('isInsideTmux', () => {
  const originalTmux = process.env['TMUX'];

  beforeEach(() => {
    delete process.env['TMUX'];
  });

  it('returns false when TMUX is not set', () => {
    expect(isInsideTmux()).toBe(false);
  });

  it('returns true when TMUX is set', () => {
    process.env['TMUX'] = '/tmp/tmux-1000/default,12345,0';
    expect(isInsideTmux()).toBe(true);
  });

  // Restore original
  beforeEach(() => {
    if (originalTmux !== undefined) {
      process.env['TMUX'] = originalTmux;
    } else {
      delete process.env['TMUX'];
    }
  });
});

describe('TmuxService with mock exec', () => {
  it('sessionExists returns true when has-session succeeds', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.sessionExists('test-session')).toBe(true);
  });

  it('sessionExists returns false when has-session throws', () => {
    const fn = () => {
      throw new Error('no session');
    };
    const svc = new TmuxService(fn);
    expect(svc.sessionExists('test-session')).toBe(false);
  });

  it('createSession calls new-session with correct args', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.createSession('paw-myapp', '/home/user/myapp');
    expect(calls[0]).toEqual(['new-session', '-d', '-s', 'paw-myapp', '-c', '/home/user/myapp']);
  });

  it('killSession calls kill-session', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.killSession('paw-myapp');
    expect(calls[0]).toEqual(['kill-session', '-t', 'paw-myapp']);
  });

  it('createPane calls split-window and returns pane ID', () => {
    const responses = new Map([['split-window -t paw-myapp -c /tmp/wt -P -F #{pane_id}', '%42']]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const paneId = svc.createPane('paw-myapp', '/tmp/wt');
    expect(paneId).toBe('%42');
  });

  it('createPane with horizontal:true appends -h flag', () => {
    const responses = new Map([
      ['split-window -t paw-myapp -c /tmp/wt -P -F #{pane_id} -h', '%43'],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const paneId = svc.createPane('paw-myapp', '/tmp/wt', { horizontal: true });
    expect(paneId).toBe('%43');
  });

  it('killPane calls kill-pane', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.killPane('%42');
    expect(calls[0]).toEqual(['kill-pane', '-t', '%42']);
  });

  it('listPanes returns array of pane IDs', () => {
    const responses = new Map([['list-panes -s -t paw-myapp -F #{pane_id}', '%1\n%2\n%3']]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    expect(svc.listPanes('paw-myapp')).toEqual(['%1', '%2', '%3']);
  });

  it('listPanes returns empty array for empty output', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.listPanes('paw-myapp')).toEqual([]);
  });

  it('paneExists returns true when display-message succeeds', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.paneExists('%42')).toBe(true);
  });

  it('paneExists returns false when display-message throws', () => {
    const fn = () => {
      throw new Error('no pane');
    };
    const svc = new TmuxService(fn);
    expect(svc.paneExists('%42')).toBe(false);
  });

  it('sendKeys sends command with Enter', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.sendKeys('%42', 'claude --resume');
    expect(calls[0]).toEqual(['send-keys', '-t', '%42', 'claude --resume', 'Enter']);
  });

  it('capturePane captures with line limit', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.capturePane('%42', 50);
    expect(calls[0]).toEqual(['capture-pane', '-t', '%42', '-p', '-S', '-50']);
  });

  it('capturePane captures without line limit', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.capturePane('%42');
    expect(calls[0]).toEqual(['capture-pane', '-t', '%42', '-p']);
  });

  it('selectLayout applies layout', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.selectLayout('paw-myapp', 'tiled');
    expect(calls[0]).toEqual(['select-layout', '-t', 'paw-myapp', 'tiled']);
  });

  it('setPaneTitle sets title via select-pane', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.setPaneTitle('%42', 'paw-auth');
    expect(calls[0]).toEqual(['select-pane', '-t', '%42', '-T', 'paw-auth']);
  });

  it('hasAttachedClient returns false when no clients', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.hasAttachedClient('paw-myapp')).toBe(false);
  });

  it('hasAttachedClient returns true when clients listed', () => {
    const responses = new Map([['list-clients -t paw-myapp -F #{client_name}', '/dev/pts/0']]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    expect(svc.hasAttachedClient('paw-myapp')).toBe(true);
  });

  it('switchClient calls switch-client', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.switchClient('paw-myapp');
    expect(calls[0]).toEqual(['switch-client', '-t', 'paw-myapp']);
  });

  it('listPanesWithTitles returns title-to-paneId map', () => {
    const responses = new Map([
      [
        'list-panes -s -t paw-myapp -F #{pane_id} #{pane_title}',
        '%1 paw-auth\n%2 paw-api\n%3 bash',
      ],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const map = svc.listPanesWithTitles('paw-myapp');
    expect(map.get('paw-auth')).toBe('%1');
    expect(map.get('paw-api')).toBe('%2');
    expect(map.get('bash')).toBe('%3');
    expect(map.size).toBe(3);
  });

  it('listPanesWithTitles returns empty map for empty output', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    const map = svc.listPanesWithTitles('paw-myapp');
    expect(map.size).toBe(0);
  });

  it('listPanesDetailed returns pane ID, title, and current command for each pane', () => {
    const responses = new Map([
      [
        'list-panes -s -t paw-myapp -F #{pane_id}\t#{pane_title}\t#{pane_current_command}',
        '%0\tpaw-orchestrator\tclaude\n%1\tpaw-auth\tclaude\n%2\tbash\tbash',
      ],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const panes = svc.listPanesDetailed('paw-myapp');
    expect(panes).toEqual([
      { paneId: '%0', title: 'paw-orchestrator', command: 'claude' },
      { paneId: '%1', title: 'paw-auth', command: 'claude' },
      { paneId: '%2', title: 'bash', command: 'bash' },
    ]);
  });

  it('listPanesDetailed returns empty array for empty output', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.listPanesDetailed('paw-myapp')).toEqual([]);
  });
});

describe('attachToTmuxSession', () => {
  it('uses switchClient when inside tmux', () => {
    const mock = createMockTmux();
    const originalTmux = process.env['TMUX'];
    process.env['TMUX'] = '/tmp/tmux-1000/default,12345,0';
    try {
      attachToTmuxSession(mock, 'paw-myapp');
      const switchCall = mock.calls.find((c) => c.method === 'switchClient');
      expect(switchCall).toBeDefined();
      expect(switchCall!.args).toEqual(['paw-myapp']);
    } finally {
      if (originalTmux !== undefined) {
        process.env['TMUX'] = originalTmux;
      } else {
        delete process.env['TMUX'];
      }
    }
  });

  it('uses attachSession when not inside tmux', () => {
    const mock = createMockTmux();
    const originalTmux = process.env['TMUX'];
    delete process.env['TMUX'];
    try {
      attachToTmuxSession(mock, 'paw-myapp');
      const attachCall = mock.calls.find((c) => c.method === 'attachSession');
      expect(attachCall).toBeDefined();
      expect(attachCall!.args).toEqual(['paw-myapp']);
    } finally {
      if (originalTmux !== undefined) {
        process.env['TMUX'] = originalTmux;
      } else {
        delete process.env['TMUX'];
      }
    }
  });
});

describe('launchTmux', () => {
  it('creates session when it does not exist', () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const createCall = mock.calls.find((c) => c.method === 'createSession');
    expect(createCall).toBeDefined();
    expect(createCall!.args).toEqual(['paw-myapp', '/home/user/myapp']);
  });

  it('skips session creation when it already exists', () => {
    const mock = createMockTmux();
    // Pre-create the session
    mock.createSession('paw-myapp', '/tmp');
    mock.calls.length = 0; // Reset calls

    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const createCalls = mock.calls.filter((c) => c.method === 'createSession');
    expect(createCalls).toHaveLength(0);
  });

  it('creates one pane per worktree', () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
      { taskName: 'tests', worktreePath: '/tmp/wt-tests', agentCommand: 'codex' },
    ];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const paneCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(paneCalls).toHaveLength(3);
    expect(panes).toHaveLength(3);
  });

  it('sends agent command to each pane', () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --resume' },
    ];
    launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall).toBeDefined();
    expect(sendCall!.args[1]).toBe('claude --resume');
  });

  it('sets pane title for each pane', () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const titleCall = mock.calls.find((c) => c.method === 'setPaneTitle');
    expect(titleCall).toBeDefined();
    expect(titleCall!.args[1]).toBe('paw-auth');
  });

  it('does not apply any layout (caller is responsible for sidebar layout)', () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    const layoutCalls = mock.calls.filter((c) => c.method === 'selectLayout');
    expect(layoutCalls).toHaveLength(0);
  });

  it('returns PawPane objects with correct structure', () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    expect(panes[0]).toMatchObject({
      id: 'paw-1',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
    });
    // paneId is assigned by the mock
    expect(panes[0]!.paneId).toMatch(/^%/);
  });

  it('sets agent field from agentCommand base name', () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'codex' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'opencode' },
      { taskName: 'tests', worktreePath: '/tmp/wt-tests', agentCommand: 'gemini' },
    ];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    expect(panes[0]!.agent).toBe('codex');
    expect(panes[1]!.agent).toBe('opencode');
    expect(panes[2]!.agent).toBe('gemini');
  });

  it('defaults agent to claude when command is unknown or has flags', () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --some-flag' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'my-custom-agent' },
    ];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    expect(panes[0]!.agent).toBe('claude');
    expect(panes[1]!.agent).toBe('claude');
  });

  it('skips tasks that already have a live pane (by paneId)', () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp', '/tmp');
    mock.calls.length = 0;

    const existingPanes: PawPane[] = [
      {
        id: 'paw-1',
        paneId: '%10',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        agent: 'claude',
        branchName: 'feature-auth',
      },
    ];
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, existingPanes);

    // Only api should be created; auth already has a live pane
    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(1);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('api');
  });

  it('relaunches task when its saved pane no longer exists in tmux', () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp', '/tmp');
    // Override paneExists to return false for %10
    mock.paneExists = (paneId: string) => {
      mock.calls.push({ method: 'paneExists', args: [paneId] });
      return paneId !== '%10';
    };
    mock.calls.length = 0;

    const existingPanes: PawPane[] = [
      {
        id: 'paw-1',
        paneId: '%10',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        agent: 'claude',
        branchName: 'feature-auth',
      },
    ];
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, existingPanes);

    // auth pane is dead — should be recreated
    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(1);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('auth');
  });

  it('works without existing panes (backward compatible)', () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    // No existingPanes argument — should behave as before
    const panes = launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('auth');
  });
});

describe('TmuxService selectPane', () => {
  it('calls select-pane -t with the pane ID', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.selectPane('%42');
    expect(calls[0]).toEqual(['select-pane', '-t', '%42']);
  });
});

describe('TmuxService getCurrentPaneId', () => {
  it('returns the current pane id from tmux', () => {
    const responses = new Map([['display-message -p #{pane_id}', '%5']]);
    const { fn, calls } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const id = svc.getCurrentPaneId();
    expect(id).toBe('%5');
    expect(calls[0]).toEqual(['display-message', '-p', '#{pane_id}']);
  });
});

describe('TmuxService getCurrentSessionName', () => {
  it('returns the current session name from tmux', () => {
    const responses = new Map([['display-message -p #{session_name}', 'paw-myapp']]);
    const { fn, calls } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const name = svc.getCurrentSessionName();
    expect(name).toBe('paw-myapp');
    expect(calls[0]).toEqual(['display-message', '-p', '#{session_name}']);
  });
});

describe('TmuxService getPaneCurrentCommand', () => {
  it('returns the running command name for a pane', () => {
    const responses = new Map([['display-message -t %5 -p #{pane_current_command}', 'bash']]);
    const { fn, calls } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const cmd = svc.getPaneCurrentCommand('%5');
    expect(cmd).toBe('bash');
    expect(calls[0]).toEqual(['display-message', '-t', '%5', '-p', '#{pane_current_command}']);
  });

  it('returns empty string when pane does not exist', () => {
    const { fn } = createMockExec(); // no matching response → throws
    const svc = new TmuxService(fn);
    const cmd = svc.getPaneCurrentCommand('%999');
    expect(cmd).toBe('');
  });
});

describe('TmuxService resizePane', () => {
  it('calls resize-pane -x with pane id and width', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.resizePane('%3', 40);
    expect(calls[0]).toEqual(['resize-pane', '-t', '%3', '-x', '40']);
  });
});

describe('TmuxService pinSidebarLayout', () => {
  it('sets main-pane-width then selects main-vertical layout', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.pinSidebarLayout('paw-test', 40);
    expect(calls[0]).toEqual(['set-window-option', '-t', 'paw-test', 'main-pane-width', '40']);
    expect(calls[1]).toEqual(['select-layout', '-t', 'paw-test', 'main-vertical']);
  });
});
