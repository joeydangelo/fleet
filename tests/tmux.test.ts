import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TmuxService,
  tmuxSessionName,
  isInsideTmux,
  launchTmux,
  launchDetached,
  createDetachedSession,
  killDetachedSession,
  listDetachedSessions,
  checkAgentLiveness,
  waitForTuiReady,
  sendBeacon,
  isTuiPromptReady,
} from '../src/lib/tmux.js';
import type { BeaconOptions } from '../src/lib/tmux.js';
import type { PawPane, PawPaneConfig, DetachedAgent } from '../src/lib/tmux.js';
import { createMockTmux } from './helpers/mock-tmux.js';

const fastBeacon: BeaconOptions = {
  tuiTimeoutMs: 100,
  tuiPollIntervalMs: 5,
  postReadyDelayMs: 5,
  verifyAttempts: 2,
  verifyDelayMs: 5,
  followUpDelays: [5, 5],
  sessionReadyTimeoutMs: 0,
};

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
  afterEach(() => {
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

  it('listPanesDetailed returns pane ID, title, command, cwd, project, and role for each pane', () => {
    const responses = new Map([
      [
        'list-panes -s -t paw-myapp -F #{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}\t#{@paw_project}\t#{@paw_role}',
        '%0\tpaw-orchestrator\tclaude\t/home/user/myapp\t/home/user/myapp\tpaw-orchestrator\n%1\tpaw-auth\tclaude\t/home/user/myapp/.paw/worktrees/auth\t/home/user/myapp\t\n%2\tbash\tbash\t/tmp\t\t',
      ],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const panes = svc.listPanesDetailed('paw-myapp');
    expect(panes).toEqual([
      {
        paneId: '%0',
        title: 'paw-orchestrator',
        command: 'claude',
        cwd: '/home/user/myapp',
        project: '/home/user/myapp',
        role: 'paw-orchestrator',
      },
      {
        paneId: '%1',
        title: 'paw-auth',
        command: 'claude',
        cwd: '/home/user/myapp/.paw/worktrees/auth',
        project: '/home/user/myapp',
        role: '',
      },
      { paneId: '%2', title: 'bash', command: 'bash', cwd: '/tmp', project: '', role: '' },
    ]);
  });

  it('listPanesDetailed returns empty array for empty output', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.listPanesDetailed('paw-myapp')).toEqual([]);
  });
});

describe('launchTmux', () => {
  it('creates session when it does not exist', async () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const createCall = mock.calls.find((c) => c.method === 'createSession');
    expect(createCall).toBeDefined();
    expect(createCall!.args).toEqual(['paw-myapp', '/home/user/myapp']);
  });

  it('skips session creation when it already exists', async () => {
    const mock = createMockTmux();
    // Pre-create the session
    mock.createSession('paw-myapp', '/tmp');
    mock.calls.length = 0; // Reset calls

    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const createCalls = mock.calls.filter((c) => c.method === 'createSession');
    expect(createCalls).toHaveLength(0);
  });

  it('creates one pane per worktree', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
      { taskName: 'tests', worktreePath: '/tmp/wt-tests', agentCommand: 'codex' },
    ];
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      [],
      fastBeacon,
    );
    const paneCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(paneCalls).toHaveLength(3);
    expect(panes).toHaveLength(3);
  });

  it('sends agent command to each pane', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --resume' },
    ];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall).toBeDefined();
    expect(sendCall!.args[1]).toBe('claude --resume');
  });

  it('sets pane title for each pane', async () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const titleCall = mock.calls.find((c) => c.method === 'setPaneTitle');
    expect(titleCall).toBeDefined();
    expect(titleCall!.args[1]).toBe('paw-auth');
  });

  it('sets @paw_project on each task pane', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const projectCalls = mock.calls.filter((c) => c.method === 'setPaneProject');
    expect(projectCalls).toHaveLength(2);
    expect(projectCalls[0]!.args[1]).toBe('/home/user/myapp');
    expect(projectCalls[1]!.args[1]).toBe('/home/user/myapp');
  });

  it('does not apply any layout (caller is responsible for sidebar layout)', async () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    await launchTmux(mock, 'paw-myapp', '/home/user/myapp', worktrees, [], fastBeacon);
    const layoutCalls = mock.calls.filter((c) => c.method === 'selectLayout');
    expect(layoutCalls).toHaveLength(0);
  });

  it('returns PawPane objects with correct structure', async () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      [],
      fastBeacon,
    );
    expect(panes[0]).toMatchObject({
      id: 'paw-1',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
    });
    // paneId is assigned by the mock
    expect(panes[0]!.paneId).toMatch(/^%/);
  });

  it('sets agent field from agentCommand base name', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'codex' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'opencode' },
      { taskName: 'tests', worktreePath: '/tmp/wt-tests', agentCommand: 'gemini' },
    ];
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      [],
      fastBeacon,
    );
    expect(panes[0]!.agent).toBe('codex');
    expect(panes[1]!.agent).toBe('opencode');
    expect(panes[2]!.agent).toBe('gemini');
  });

  it('defaults agent to claude when command is unknown or has flags', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --some-flag' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'my-custom-agent' },
    ];
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      [],
      fastBeacon,
    );
    expect(panes[0]!.agent).toBe('claude');
    expect(panes[1]!.agent).toBe('claude');
  });

  it('skips tasks that already have a live pane (by paneId)', async () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp', '/tmp');
    // %10 is alive in tmux
    mock.listPanes = (sessionName: string) => {
      mock.calls.push({ method: 'listPanes', args: [sessionName] });
      return ['%10'];
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
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      existingPanes,
      fastBeacon,
    );

    // Only api should be created; auth already has a live pane
    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(1);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('api');
  });

  it('relaunches task when its saved pane no longer exists in tmux', async () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp', '/tmp');
    // %10 is NOT in the live pane list (killed)
    mock.listPanes = (sessionName: string) => {
      mock.calls.push({ method: 'listPanes', args: [sessionName] });
      return [];
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
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      existingPanes,
      fastBeacon,
    );

    // auth pane is dead — should be recreated
    const createCalls = mock.calls.filter((c) => c.method === 'createPane');
    expect(createCalls).toHaveLength(1);
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('auth');
  });

  it('works without existing panes (backward compatible)', async () => {
    const mock = createMockTmux();
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    // No existingPanes argument — should behave as before
    const panes = await launchTmux(
      mock,
      'paw-myapp',
      '/home/user/myapp',
      worktrees,
      [],
      fastBeacon,
    );
    expect(panes).toHaveLength(1);
    expect(panes[0]!.taskName).toBe('auth');
  });
});

describe('TmuxService setPaneProject', () => {
  it('calls set-option with @paw_project', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.setPaneProject('%5', '/home/user/myapp');
    expect(calls[0]).toEqual(['set-option', '-p', '-t', '%5', '@paw_project', '/home/user/myapp']);
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

describe('createDetachedSession', () => {
  it('creates a tmux session and sends the agent command', async () => {
    const mock = createMockTmux();
    await createDetachedSession(mock, 'paw-myapp-auth', '/tmp/wt-auth', 'claude', fastBeacon);

    const createCall = mock.calls.find((c) => c.method === 'createSession');
    expect(createCall).toBeDefined();
    expect(createCall!.args).toEqual(['paw-myapp-auth', '/tmp/wt-auth']);

    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall).toBeDefined();
    expect(sendCall!.args[1]).toBe('claude');
  });

  it('sends keys to the session name (first pane)', async () => {
    const mock = createMockTmux();
    await createDetachedSession(mock, 'paw-myapp-api', '/tmp/wt-api', 'codex --flag', fastBeacon);

    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall!.args[0]).toBe('paw-myapp-api');
  });
});

describe('killDetachedSession', () => {
  it('kills a session that exists', () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.calls.length = 0;

    killDetachedSession(mock, 'paw-myapp-auth');

    const killCall = mock.calls.find((c) => c.method === 'killSession');
    expect(killCall).toBeDefined();
    expect(killCall!.args).toEqual(['paw-myapp-auth']);
  });

  it('does nothing when session does not exist', () => {
    const mock = createMockTmux();
    killDetachedSession(mock, 'paw-myapp-nonexistent');

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });
});

describe('listDetachedSessions', () => {
  it('returns session names matching the prefix', () => {
    const mock = createMockTmux();
    // Override sessionExists to simulate listing
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.createSession('paw-myapp-api', '/tmp');
    mock.calls.length = 0;

    const names = ['paw-myapp-auth', 'paw-myapp-api'];
    const result = listDetachedSessions(mock, names);

    expect(result).toEqual(['paw-myapp-auth', 'paw-myapp-api']);
  });

  it('filters out sessions that no longer exist', () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const names = ['paw-myapp-auth', 'paw-myapp-gone'];
    const result = listDetachedSessions(mock, names);

    expect(result).toEqual(['paw-myapp-auth']);
  });

  it('returns empty array when no sessions exist', () => {
    const mock = createMockTmux();
    const result = listDetachedSessions(mock, ['paw-myapp-auth']);
    expect(result).toEqual([]);
  });
});

describe('launchDetached', () => {
  it('creates one detached session per worktree', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'codex' },
    ];
    const agents = await launchDetached(mock, 'paw-myapp', worktrees, [], fastBeacon);
    expect(agents).toHaveLength(2);

    const createCalls = mock.calls.filter((c) => c.method === 'createSession');
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]!.args[0]).toBe('paw-myapp-auth');
    expect(createCalls[1]!.args[0]).toBe('paw-myapp-api');
  });

  it('sends agent command into each session', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --resume' },
    ];
    await launchDetached(mock, 'paw-myapp', worktrees, [], fastBeacon);

    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall).toBeDefined();
    expect(sendCall!.args[1]).toBe('claude --resume');
  });

  it('returns DetachedAgent objects with correct structure', async () => {
    const mock = createMockTmux();
    const worktrees = [
      {
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        agentCommand: 'claude',
        branchName: 'feat-auth',
      },
    ];
    const agents = await launchDetached(mock, 'paw-myapp', worktrees, [], fastBeacon);
    expect(agents[0]).toMatchObject({
      id: 'paw-1',
      sessionName: 'paw-myapp-auth',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
      agent: 'claude',
      branchName: 'feat-auth',
    });
  });

  it('skips tasks that already have a live session', async () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const existing: DetachedAgent[] = [
      {
        id: 'paw-1',
        sessionName: 'paw-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        agent: 'claude',
        branchName: '',
      },
    ];
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'paw-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.taskName).toBe('api');
  });

  it('relaunches task when its session no longer exists', async () => {
    const mock = createMockTmux();
    // Don't create the session — it's dead

    const existing: DetachedAgent[] = [
      {
        id: 'paw-1',
        sessionName: 'paw-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        agent: 'claude',
        branchName: '',
      },
    ];
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    const agents = await launchDetached(mock, 'paw-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.taskName).toBe('auth');
  });
});

describe('checkAgentLiveness', () => {
  it('checks detached sessions via sessionExists', () => {
    const mock = createMockTmux();
    mock.createSession('paw-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const config: PawPaneConfig = {
      mode: 'detached',
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      orchestratorPaneId: '',
      panes: [],
      detached: [
        {
          id: 'paw-1',
          sessionName: 'paw-myapp-auth',
          taskName: 'auth',
          worktreePath: '/tmp/wt-auth',
          agent: 'claude',
          branchName: '',
        },
        {
          id: 'paw-2',
          sessionName: 'paw-myapp-api',
          taskName: 'api',
          worktreePath: '/tmp/wt-api',
          agent: 'claude',
          branchName: '',
        },
      ],
      lastUpdated: new Date().toISOString(),
    };

    const result = checkAgentLiveness(mock, config);
    expect(result).toEqual([
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: false },
    ]);
  });

  it('checks attached panes via paneExists', () => {
    const mock = createMockTmux();
    mock.calls.length = 0;

    const config: PawPaneConfig = {
      mode: 'attached',
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      orchestratorPaneId: '%0',
      panes: [
        {
          id: 'paw-1',
          paneId: '%1',
          taskName: 'auth',
          worktreePath: '/tmp/wt-auth',
          agent: 'claude',
          branchName: '',
        },
        {
          id: 'paw-2',
          paneId: '%2',
          taskName: 'api',
          worktreePath: '/tmp/wt-api',
          agent: 'claude',
          branchName: '',
        },
      ],
      lastUpdated: new Date().toISOString(),
    };

    // mock paneExists returns true by default
    const result = checkAgentLiveness(mock, config);
    expect(result).toEqual([
      { taskName: 'auth', alive: true },
      { taskName: 'api', alive: true },
    ]);
  });

  it('defaults to attached mode when mode field is missing', () => {
    const mock = createMockTmux();

    const config: PawPaneConfig = {
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      orchestratorPaneId: '%0',
      panes: [
        {
          id: 'paw-1',
          paneId: '%1',
          taskName: 'auth',
          worktreePath: '/tmp/wt-auth',
          agent: 'claude',
          branchName: '',
        },
      ],
      lastUpdated: new Date().toISOString(),
    };

    const result = checkAgentLiveness(mock, config);
    expect(result).toHaveLength(1);
    expect(result[0]!.taskName).toBe('auth');
  });

  it('returns empty array when no agents are registered', () => {
    const mock = createMockTmux();

    const config: PawPaneConfig = {
      mode: 'detached',
      sessionName: 'paw-myapp',
      projectRoot: '/home/user/myapp',
      orchestratorPaneId: '',
      panes: [],
      detached: [],
      lastUpdated: new Date().toISOString(),
    };

    const result = checkAgentLiveness(mock, config);
    expect(result).toEqual([]);
  });
});

describe('waitForTuiReady', () => {
  it('returns true immediately when prompt is ready', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return 'Claude Code v1.0\n❯';
    };

    const ready = await waitForTuiReady(mock, 'paw-test', 5000, 10);
    expect(ready).toBe(true);
  });

  it('does not return true for shell output without prompt', async () => {
    const mock = createMockTmux();
    let callCount = 0;
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      callCount++;
      // First calls return shell output ($ claude), not the TUI prompt
      if (callCount < 3) return '$ claude --dangerously-skip-permissions';
      // Eventually the TUI renders with the ❯ prompt
      return 'Claude Code v1.0\n❯';
    };
    mock.createSession('paw-test', '/tmp');

    const ready = await waitForTuiReady(mock, 'paw-test', 5000, 10);
    expect(ready).toBe(true);
    expect(callCount).toBe(3);
  });

  it('polls until prompt appears', async () => {
    const mock = createMockTmux();
    let callCount = 0;
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      callCount++;
      return callCount >= 3 ? 'Welcome!\n❯' : null;
    };
    mock.createSession('paw-test', '/tmp');

    const ready = await waitForTuiReady(mock, 'paw-test', 5000, 10);
    expect(ready).toBe(true);
    expect(callCount).toBe(3);
  });

  it('returns false on timeout', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return null;
    };
    mock.createSession('paw-test', '/tmp');

    const ready = await waitForTuiReady(mock, 'paw-test', 50, 10);
    expect(ready).toBe(false);
  });

  it('returns false when session dies during polling', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return null;
    };
    // Session doesn't exist — sessionExists returns false

    const ready = await waitForTuiReady(mock, 'paw-nonexistent', 5000, 10);
    expect(ready).toBe(false);
  });
});

describe('isTuiPromptReady', () => {
  it('detects ❯ prompt character', () => {
    expect(isTuiPromptReady('Claude Code v1.0\n❯')).toBe(true);
    expect(isTuiPromptReady('❯ some input')).toBe(true);
  });

  it('detects welcome screen with Try indicator', () => {
    expect(isTuiPromptReady('Try "help me refactor my code"')).toBe(true);
  });

  it('detects > at start of line as fallback', () => {
    expect(isTuiPromptReady('some header\n> prompt')).toBe(true);
    expect(isTuiPromptReady('> prompt')).toBe(true);
  });

  it('rejects plain shell output without prompt', () => {
    expect(isTuiPromptReady('$ claude --dangerously-skip-permissions')).toBe(false);
    expect(isTuiPromptReady('Loading...')).toBe(false);
    expect(isTuiPromptReady('npm info paw@0.1.0')).toBe(false);
  });

  it('rejects > in the middle of a line (not a prompt)', () => {
    expect(isTuiPromptReady('output -> result')).toBe(false);
  });
});

describe('sendBeacon', () => {
  const fastOpts: BeaconOptions = {
    tuiTimeoutMs: 100,
    tuiPollIntervalMs: 5,
    postReadyDelayMs: 5,
    verifyAttempts: 5,
    verifyDelayMs: 5,
    followUpDelays: [5, 5],
  };

  it('sends beacon message and follow-up Enters after TUI is ready', async () => {
    const mock = createMockTmux();
    mock.createSession('paw-test', '/tmp');
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return 'Claude Code output — agent is working\n❯';
    };

    const result = await sendBeacon(mock, 'paw-test', fastOpts);
    expect(result).toBe(true);

    const sendCalls = mock.calls.filter((c) => c.method === 'sendKeys');
    // Beacon message + 2 follow-up empty Enters (minimum)
    expect(sendCalls.length).toBeGreaterThanOrEqual(3);
    expect(sendCalls[0]!.args[1]).toBe('Begin working on your task.');
    // Follow-up Enters are empty strings
    expect(sendCalls[1]!.args[1]).toBe('');
    expect(sendCalls[2]!.args[1]).toBe('');
  });

  it('returns false when TUI never becomes ready', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = () => null;

    const result = await sendBeacon(mock, 'paw-nonexistent', fastOpts);
    expect(result).toBe(false);
  });

  it('retries beacon when welcome screen is still showing', async () => {
    const mock = createMockTmux();
    mock.createSession('paw-test', '/tmp');

    let captureCount = 0;
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      captureCount++;
      if (captureCount === 1) return 'Welcome to Claude Code\n❯';
      if (captureCount <= 3) return 'Try "help me refactor..."';
      return 'Agent is working on task\n❯';
    };

    const result = await sendBeacon(mock, 'paw-test', fastOpts);
    expect(result).toBe(true);

    const sendCalls = mock.calls.filter((c) => c.method === 'sendKeys');
    expect(sendCalls.length).toBeGreaterThanOrEqual(2);
  });
});
