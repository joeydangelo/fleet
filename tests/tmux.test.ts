import { describe, it, expect } from 'vitest';
import {
  TmuxService,
  tmuxSessionName,
  launchDetached,
  createDetachedSession,
  killDetachedSession,
  listDetachedSessions,
  checkAgentLiveness,
  waitForAgentReady,
  sendBeacon,
  isAgentPromptReady,
  sendWakeSignal,
} from '../src/lib/tmux.js';
import type { BeaconOptions } from '../src/lib/tmux.js';
import type { FleetPaneConfig, DetachedAgent } from '../src/lib/tmux.js';
import { createMockTmux } from './helpers/mock-tmux.js';

const fastBeacon: BeaconOptions = {
  agentTimeoutMs: 100,
  agentPollIntervalMs: 5,
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
    expect(tmuxSessionName('myapp')).toBe('fleet-myapp');
  });

  it('replaces non-alphanumeric characters with hyphens', () => {
    expect(tmuxSessionName('my_app.v2')).toBe('fleet-my-app-v2');
  });

  it('collapses consecutive hyphens', () => {
    expect(tmuxSessionName('my---app')).toBe('fleet-my-app');
  });

  it('strips leading and trailing hyphens from the sanitized part', () => {
    expect(tmuxSessionName('-myapp-')).toBe('fleet-myapp');
  });

  it('handles directories with spaces', () => {
    expect(tmuxSessionName('my app')).toBe('fleet-my-app');
  });

  it('handles complex directory names', () => {
    expect(tmuxSessionName('My Project (v2.1)')).toBe('fleet-My-Project-v2-1');
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
    svc.createSession('fleet-myapp', '/home/user/myapp');
    expect(calls[0]).toEqual(['new-session', '-d', '-s', 'fleet-myapp', '-c', '/home/user/myapp']);
  });

  it('killSession calls kill-session', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.killSession('fleet-myapp');
    expect(calls[0]).toEqual(['kill-session', '-t', 'fleet-myapp']);
  });

  it('sendKeys sends command with Enter', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.sendKeys('%42', 'claude --resume');
    expect(calls[0]).toEqual(['send-keys', '-t', '%42', 'claude --resume', 'Enter']);
  });

  it('setPaneTitle sets title via select-pane', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.setPaneTitle('%42', 'fleet-auth');
    expect(calls[0]).toEqual(['select-pane', '-t', '%42', '-T', 'fleet-auth']);
  });

  it('listPanesDetailed returns pane ID, title, command, cwd, project, and role for each pane', () => {
    const responses = new Map([
      [
        'list-panes -s -t fleet-myapp -F #{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}\t#{@fleet_project}\t#{@fleet_role}',
        '%0\tfleet-orchestrator\tclaude\t/home/user/myapp\t/home/user/myapp\tfleet-orchestrator\n%1\tfleet-auth\tclaude\t/home/user/myapp/.fleet/worktrees/auth\t/home/user/myapp\t\n%2\tbash\tbash\t/tmp\t\t',
      ],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const panes = svc.listPanesDetailed('fleet-myapp');
    expect(panes).toEqual([
      {
        paneId: '%0',
        title: 'fleet-orchestrator',
        command: 'claude',
        cwd: '/home/user/myapp',
        project: '/home/user/myapp',
        role: 'fleet-orchestrator',
      },
      {
        paneId: '%1',
        title: 'fleet-auth',
        command: 'claude',
        cwd: '/home/user/myapp/.fleet/worktrees/auth',
        project: '/home/user/myapp',
        role: '',
      },
      { paneId: '%2', title: 'bash', command: 'bash', cwd: '/tmp', project: '', role: '' },
    ]);
  });

  it('listPanesDetailed returns empty array for empty output', () => {
    const { fn } = createMockExec();
    const svc = new TmuxService(fn);
    expect(svc.listPanesDetailed('fleet-myapp')).toEqual([]);
  });
});

describe('TmuxService listSessions', () => {
  it('returns parsed session names from tmux output', () => {
    const responses = new Map([
      ['list-sessions -F #{session_name}', 'fleet-myapp\nfleet-other\ndefault'],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const sessions = svc.listSessions();
    expect(sessions).toEqual(['fleet-myapp', 'fleet-other', 'default']);
  });

  it('returns empty array when tmux is not running', () => {
    const fn = () => {
      throw new Error('no server running');
    };
    const svc = new TmuxService(fn);
    expect(svc.listSessions()).toEqual([]);
  });
});

describe('TmuxService capturePaneContent', () => {
  it('returns captured content when pane has output', () => {
    const responses = new Map([
      ['capture-pane -t %5 -p -S -50', 'Claude Code v1.0\nTask: auth\n❯ implementing feature'],
    ]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const content = svc.capturePaneContent('%5');
    expect(content).toContain('Claude Code v1.0');
    expect(content).toContain('❯');
  });

  it('returns null when pane does not exist', () => {
    const fn = () => {
      throw new Error('pane not found');
    };
    const svc = new TmuxService(fn);
    expect(svc.capturePaneContent('%999')).toBeNull();
  });

  it('returns null when content is empty', () => {
    const responses = new Map([['capture-pane -t %5 -p -S -50', '']]);
    const { fn } = createMockExec(responses);
    const svc = new TmuxService(fn);
    expect(svc.capturePaneContent('%5')).toBeNull();
  });
});

describe('TmuxService setPaneProject', () => {
  it('calls set-option with @fleet_project', () => {
    const { fn, calls } = createMockExec();
    const svc = new TmuxService(fn);
    svc.setPaneProject('%5', '/home/user/myapp');
    expect(calls[0]).toEqual([
      'set-option',
      '-p',
      '-t',
      '%5',
      '@fleet_project',
      '/home/user/myapp',
    ]);
  });
});

describe('TmuxService getCurrentSessionName', () => {
  it('returns the current session name from tmux', () => {
    const responses = new Map([['display-message -p #{session_name}', 'fleet-myapp']]);
    const { fn, calls } = createMockExec(responses);
    const svc = new TmuxService(fn);
    const name = svc.getCurrentSessionName();
    expect(name).toBe('fleet-myapp');
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

  it('returns null when pane does not exist', () => {
    const fn = () => {
      throw new Error('pane not found');
    };
    const svc = new TmuxService(fn);
    const cmd = svc.getPaneCurrentCommand('%999');
    expect(cmd).toBeNull();
  });
});

describe('createDetachedSession', () => {
  it('creates a tmux session and sends the agent command', async () => {
    const mock = createMockTmux();
    await createDetachedSession(mock, 'fleet-myapp-auth', '/tmp/wt-auth', 'claude', fastBeacon);

    const createCall = mock.calls.find((c) => c.method === 'createSession');
    expect(createCall).toBeDefined();
    expect(createCall!.args).toEqual(['fleet-myapp-auth', '/tmp/wt-auth']);

    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall).toBeDefined();
    expect(sendCall!.args[1]).toBe('claude');
  });

  it('sends keys to the session name (first pane)', async () => {
    const mock = createMockTmux();
    await createDetachedSession(
      mock,
      'fleet-myapp-api',
      '/tmp/wt-api',
      'claude --flag',
      fastBeacon,
    );

    const sendCall = mock.calls.find((c) => c.method === 'sendKeys');
    expect(sendCall!.args[0]).toBe('fleet-myapp-api');
  });
});

describe('killDetachedSession', () => {
  it('kills a session that exists', () => {
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    killDetachedSession(mock, 'fleet-myapp-auth');

    const killCall = mock.calls.find((c) => c.method === 'killSession');
    expect(killCall).toBeDefined();
    expect(killCall!.args).toEqual(['fleet-myapp-auth']);
  });

  it('does nothing when session does not exist', () => {
    const mock = createMockTmux();
    killDetachedSession(mock, 'fleet-myapp-nonexistent');

    const killCalls = mock.calls.filter((c) => c.method === 'killSession');
    expect(killCalls).toHaveLength(0);
  });
});

describe('listDetachedSessions', () => {
  it('returns session names matching the prefix', () => {
    const mock = createMockTmux();
    // Override sessionExists to simulate listing
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.createSession('fleet-myapp-api', '/tmp');
    mock.calls.length = 0;

    const names = ['fleet-myapp-auth', 'fleet-myapp-api'];
    const result = listDetachedSessions(mock, names);

    expect(result).toEqual(['fleet-myapp-auth', 'fleet-myapp-api']);
  });

  it('filters out sessions that no longer exist', () => {
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const names = ['fleet-myapp-auth', 'fleet-myapp-gone'];
    const result = listDetachedSessions(mock, names);

    expect(result).toEqual(['fleet-myapp-auth']);
  });

  it('returns empty array when no sessions exist', () => {
    const mock = createMockTmux();
    const result = listDetachedSessions(mock, ['fleet-myapp-auth']);
    expect(result).toEqual([]);
  });
});

describe('launchDetached', () => {
  it('creates one detached session per worktree', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, [], fastBeacon);
    expect(agents).toHaveLength(2);

    const createCalls = mock.calls.filter((c) => c.method === 'createSession');
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]!.args[0]).toBe('fleet-myapp-auth');
    expect(createCalls[1]!.args[0]).toBe('fleet-myapp-api');
  });

  it('sends agent command into each session', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude --resume' },
    ];
    await launchDetached(mock, 'fleet-myapp', worktrees, [], fastBeacon);

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
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, [], fastBeacon);
    expect(agents[0]).toMatchObject({
      id: 'fleet-1',
      sessionName: 'fleet-myapp-auth',
      taskName: 'auth',
      worktreePath: '/tmp/wt-auth',
      branchName: 'feat-auth',
    });
  });

  it('skips tasks that already have a live session', async () => {
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const existing: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.taskName).toBe('api');
  });

  it('relaunches task when its session no longer exists', async () => {
    const mock = createMockTmux();
    // Don't create the session — it's dead

    const existing: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    const worktrees = [{ taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' }];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.taskName).toBe('auth');
  });

  it('assigns stable IDs from original worktrees array, not filtered index', async () => {
    const mock = createMockTmux();
    // auth (index 0) is already live, only api (index 1) and db (index 2) are pending
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const existing: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
      { taskName: 'db', worktreePath: '/tmp/wt-db', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(2);
    // IDs must reflect original array positions (2 and 3), not filtered positions (1 and 2)
    expect(agents[0]!.id).toBe('fleet-2');
    expect(agents[0]!.taskName).toBe('api');
    expect(agents[1]!.id).toBe('fleet-3');
    expect(agents[1]!.taskName).toBe('db');
  });

  it('assigns sequential IDs when all tasks are pending', async () => {
    const mock = createMockTmux();
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, [], fastBeacon);

    expect(agents[0]!.id).toBe('fleet-1');
    expect(agents[1]!.id).toBe('fleet-2');
  });

  it('assigns correct ID when single task is pending', async () => {
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const existing: DetachedAgent[] = [
      {
        id: 'fleet-1',
        sessionName: 'fleet-myapp-auth',
        taskName: 'auth',
        worktreePath: '/tmp/wt-auth',
        branchName: '',
      },
    ];
    const worktrees = [
      { taskName: 'auth', worktreePath: '/tmp/wt-auth', agentCommand: 'claude' },
      { taskName: 'api', worktreePath: '/tmp/wt-api', agentCommand: 'claude' },
    ];
    const agents = await launchDetached(mock, 'fleet-myapp', worktrees, existing, fastBeacon);

    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe('fleet-2');
    expect(agents[0]!.taskName).toBe('api');
  });
});

describe('checkAgentLiveness', () => {
  it('checks detached sessions via sessionExists', () => {
    const mock = createMockTmux();
    mock.createSession('fleet-myapp-auth', '/tmp');
    mock.calls.length = 0;

    const config: FleetPaneConfig = {
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
        {
          id: 'fleet-2',
          sessionName: 'fleet-myapp-api',
          taskName: 'api',
          worktreePath: '/tmp/wt-api',
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

  it('returns empty array when no agents are registered', () => {
    const mock = createMockTmux();

    const config: FleetPaneConfig = {
      mode: 'detached',
      sessionName: 'fleet-myapp',
      repoRoot: '/home/user/myapp',
      detached: [],
      lastUpdated: new Date().toISOString(),
    };

    const result = checkAgentLiveness(mock, config);
    expect(result).toEqual([]);
  });
});

describe('waitForAgentReady', () => {
  it('returns true immediately when prompt is ready', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return 'Claude Code v1.0\n❯';
    };

    const ready = await waitForAgentReady(mock, 'fleet-test', 5000, 10);
    expect(ready).toBe(true);
  });

  it('does not return true for shell output without prompt', async () => {
    const mock = createMockTmux();
    let callCount = 0;
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      callCount++;
      if (callCount < 3) return '$ claude --dangerously-skip-permissions';
      return 'Claude Code v1.0\n❯';
    };
    mock.createSession('fleet-test', '/tmp');

    const ready = await waitForAgentReady(mock, 'fleet-test', 5000, 10);
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
    mock.createSession('fleet-test', '/tmp');

    const ready = await waitForAgentReady(mock, 'fleet-test', 5000, 10);
    expect(ready).toBe(true);
    expect(callCount).toBe(3);
  });

  it('returns false on timeout', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return null;
    };
    mock.createSession('fleet-test', '/tmp');

    const ready = await waitForAgentReady(mock, 'fleet-test', 50, 10);
    expect(ready).toBe(false);
  });

  it('returns false when session dies during polling', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return null;
    };
    // Session doesn't exist — sessionExists returns false

    const ready = await waitForAgentReady(mock, 'fleet-nonexistent', 5000, 10);
    expect(ready).toBe(false);
  });
});

describe('isAgentPromptReady', () => {
  it('detects ❯ prompt character', () => {
    expect(isAgentPromptReady('Claude Code v1.0\n❯')).toBe(true);
    expect(isAgentPromptReady('❯ some input')).toBe(true);
  });

  it('detects welcome screen with Try indicator', () => {
    expect(isAgentPromptReady('Try "help me refactor my code"')).toBe(true);
  });

  it('detects > at start of line as fallback', () => {
    expect(isAgentPromptReady('some header\n> prompt')).toBe(true);
    expect(isAgentPromptReady('> prompt')).toBe(true);
  });

  it('rejects plain shell output without prompt', () => {
    expect(isAgentPromptReady('$ claude --dangerously-skip-permissions')).toBe(false);
    expect(isAgentPromptReady('Loading...')).toBe(false);
    expect(isAgentPromptReady('npm info fleet@0.1.0')).toBe(false);
  });

  it('rejects > in the middle of a line (not a prompt)', () => {
    expect(isAgentPromptReady('output -> result')).toBe(false);
  });
});

describe('sendBeacon', () => {
  const fastOpts: BeaconOptions = {
    agentTimeoutMs: 100,
    agentPollIntervalMs: 5,
    postReadyDelayMs: 5,
    verifyAttempts: 5,
    verifyDelayMs: 5,
    followUpDelays: [5, 5],
  };

  it('sends beacon message and follow-up Enters after agent is ready', async () => {
    const mock = createMockTmux();
    mock.createSession('fleet-test', '/tmp');
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      return 'Claude Code output — agent is working\n❯';
    };

    const result = await sendBeacon(mock, 'fleet-test', fastOpts);
    expect(result).toBe(true);

    const sendCalls = mock.calls.filter((c) => c.method === 'sendKeys');
    // Beacon message + 2 follow-up empty Enters (minimum)
    expect(sendCalls.length).toBeGreaterThanOrEqual(3);
    expect(sendCalls[0]!.args[1]).toBe(
      'Run `fleet shortcut build-task` and follow its instructions.',
    );
    // Follow-up Enters are empty strings
    expect(sendCalls[1]!.args[1]).toBe('');
    expect(sendCalls[2]!.args[1]).toBe('');
  });

  it('returns false when agent never becomes ready', async () => {
    const mock = createMockTmux();
    mock.capturePaneContent = () => null;

    const result = await sendBeacon(mock, 'fleet-nonexistent', fastOpts);
    expect(result).toBe(false);
  });

  it('retries beacon when welcome screen is still showing', async () => {
    const mock = createMockTmux();
    mock.createSession('fleet-test', '/tmp');

    let captureCount = 0;
    mock.capturePaneContent = (session: string) => {
      mock.calls.push({ method: 'capturePaneContent', args: [session] });
      captureCount++;
      if (captureCount === 1) return 'Welcome to Claude Code\n❯';
      if (captureCount <= 3) return 'Try "help me refactor..."';
      return 'Agent is working on task\n❯';
    };

    const result = await sendBeacon(mock, 'fleet-test', fastOpts);
    expect(result).toBe(true);

    const sendCalls = mock.calls.filter((c) => c.method === 'sendKeys');
    expect(sendCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('sendWakeSignal', () => {
  it('sends empty keys and returns true on success', () => {
    const mock = createMockTmux();
    const result = sendWakeSignal(mock, '%42');
    expect(result).toBe(true);
    const sendCalls = mock.calls.filter((c) => c.method === 'sendKeys');
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.args).toEqual(['%42', '']);
  });

  it('returns false when sendKeys throws', () => {
    const mock = createMockTmux();
    mock.sendKeys = () => {
      throw new Error('pane dead');
    };
    const result = sendWakeSignal(mock, '%42');
    expect(result).toBe(false);
  });
});
