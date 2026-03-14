import { describe, it, expect } from 'vitest';
import { taskDisplayStatus } from '../src/lib/tui-helpers.js';
import { buildDisplayItems } from '../src/components/tui-app.js';
import type { TaskState, MergeEntry, SyncState } from '../src/lib/sync.js';
import type { PawPane, TmuxPaneInfo } from '../src/lib/tmux.js';

describe('taskDisplayStatus', () => {
  it('returns pending when no task state exists', () => {
    expect(taskDisplayStatus(undefined, undefined)).toBe('pending');
  });

  it('returns explicit status when task has one (proves fallback is load-bearing)', () => {
    const task: TaskState = { status: 'done' };
    expect(taskDisplayStatus(task, undefined)).toBe('done');
    expect(taskDisplayStatus(task, undefined)).not.toBe('pending');
  });

  it('returns conflict when merge entry has conflict status', () => {
    const task: TaskState = { status: 'done' };
    const merge: MergeEntry = { status: 'conflict' };
    expect(taskDisplayStatus(task, merge)).toBe('conflict');
  });

  it('does not override non-conflict merge statuses', () => {
    const task: TaskState = { status: 'done' };
    const merge: MergeEntry = { status: 'merged' };
    expect(taskDisplayStatus(task, merge)).toBe('done');
  });

  it('returns zombie when health state is zombie', () => {
    const task: TaskState = { status: 'in_progress' };
    expect(taskDisplayStatus(task, undefined, 'zombie')).toBe('zombie');
  });
});

// --- buildDisplayItems ---

function makePane(taskName: string, paneId: string): PawPane {
  return {
    id: `paw-1`,
    paneId,
    taskName,
    worktreePath: `/tmp/wt-${taskName}`,
    agent: 'claude',
    branchName: `feature-${taskName}`,
  };
}

function makeTmuxPane(paneId: string, title: string, command: string): TmuxPaneInfo {
  return { paneId, title, command, cwd: '/home/user/myapp', project: '/home/user/myapp', role: '' };
}

describe('buildDisplayItems', () => {
  it('shows task panes with sync state status', () => {
    const tmuxPanes = [makeTmuxPane('%1', 'paw-auth', 'claude')];
    const taskPanes = [makePane('auth', '%1')];
    const syncState: SyncState = {
      session: 'paw-test',
      config: 'paw.yaml',
      target: 'main',
      tasks: { auth: { status: 'in_progress' } },
    };

    const items = buildDisplayItems(tmuxPanes, taskPanes, syncState, '%0', '');
    expect(items).toEqual([{ paneId: '%1', label: 'auth', badge: '[cc]', status: 'in_progress' }]);
  });

  it('labels orchestrator pane from panes.json orchestratorPaneId', () => {
    const tmuxPanes = [makeTmuxPane('%2', 'AA822972-1', 'claude')];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%2');
    expect(items).toEqual([{ paneId: '%2', label: 'orchestrator', badge: '[cc]', status: null }]);
  });

  it('excludes the TUI control pane from the display list', () => {
    const tmuxPanes = [
      makeTmuxPane('%0', 'bash', 'bash'),
      makeTmuxPane('%1', 'AA822972-1', 'claude'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1');
    expect(items).toHaveLength(1);
    expect(items[0]!.paneId).toBe('%1');
    expect(items[0]!.label).toBe('orchestrator');
  });

  it('shows orchestrator before task panes, task panes before ad-hoc', () => {
    const tmuxPanes = [
      makeTmuxPane('%0', 'bash', 'bash'), // TUI — excluded
      makeTmuxPane('%1', 'AA822972-1', 'bash'), // orchestrator (title stomped by app)
      makeTmuxPane('%2', 'paw-auth', 'claude'), // task
      makeTmuxPane('%4', 'my-scratch', 'node'), // ad-hoc
    ];
    const taskPanes = [makePane('auth', '%2')];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '%1');
    expect(items[0]!.label).toBe('orchestrator'); // orchestrator first
    expect(items[1]!.label).toBe('auth'); // task second
    expect(items[2]!.label).toBe('my-scratch'); // ad-hoc last
  });

  it('drops task panes that are no longer alive in tmux', () => {
    const tmuxPanes = [makeTmuxPane('%1', 'paw-auth', 'claude')];
    const taskPanes = [makePane('auth', '%1'), makePane('api', '%99')];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '');
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('auth');
  });

  it('uses pane ID as fallback label for untitled panes', () => {
    const tmuxPanes = [makeTmuxPane('%5', 'bash', 'bash')];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '');
    expect(items[0]!.label).toBe('pane %5');
  });

  it('updates badge when command changes (e.g. bash -> claude)', () => {
    const tmuxPanes = [makeTmuxPane('%2', 'paw-auth', 'bash')];
    const taskPanes = [makePane('auth', '%2')];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '');
    expect(items[0]!.badge).toBe('[bash]');

    // Simulate next poll: command changed to claude
    const tmuxPanes2 = [makeTmuxPane('%2', 'paw-auth', 'claude')];
    const items2 = buildDisplayItems(tmuxPanes2, taskPanes, null, '%0', '');
    expect(items2[0]!.badge).toBe('[cc]');
  });

  it('shows conflict status when merge entry has conflict', () => {
    const tmuxPanes = [makeTmuxPane('%1', 'paw-api', 'claude')];
    const taskPanes = [makePane('api', '%1')];
    const syncState: SyncState = {
      session: 'paw-test',
      config: 'paw.yaml',
      target: 'main',
      tasks: { api: { status: 'done' } },
      merges: { api: { status: 'conflict' } },
    };
    const items = buildDisplayItems(tmuxPanes, taskPanes, syncState, '%0', '');
    expect(items[0]!.status).toBe('conflict');
  });

  it('recovers task label and status from @paw_role when pane not in panes.json', () => {
    // Simulate a task pane that's NOT in panes.json (timing issue or pane ID shift)
    // but has @paw_role set to 'paw-auth' by launchTmux.
    const tmuxPanes: TmuxPaneInfo[] = [
      {
        paneId: '%3',
        title: 'Claude Code',
        command: 'claude',
        cwd: '/home/user/myapp',
        project: '/home/user/myapp',
        role: 'paw-auth',
      },
    ];
    const syncState: SyncState = {
      session: 'paw-test',
      config: 'paw.yaml',
      target: 'main',
      tasks: { auth: { status: 'in_progress' } },
    };
    // No task panes passed — simulates panes.json not yet written
    const items = buildDisplayItems(tmuxPanes, [], syncState, '%0', '');
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('auth');
    expect(items[0]!.status).toBe('in_progress');
  });

  it('recovers task label with health state from @paw_role', () => {
    const tmuxPanes: TmuxPaneInfo[] = [
      {
        paneId: '%3',
        title: 'Claude Code',
        command: 'claude',
        cwd: '/home/user/myapp',
        project: '/home/user/myapp',
        role: 'paw-auth',
      },
    ];
    const syncState: SyncState = {
      session: 'paw-test',
      config: 'paw.yaml',
      target: 'main',
      tasks: { auth: { status: 'in_progress' } },
    };
    const health = {
      timestamp: new Date().toISOString(),
      agents: {
        auth: {
          taskName: 'auth',
          state: 'stalled' as const,
          lastActivity: null,
          stalledSince: null,
          escalationLevel: 1,
        },
      },
    };
    const items = buildDisplayItems(tmuxPanes, [], syncState, '%0', '', undefined, health);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('auth');
    expect(items[0]!.status).toBe('stalled');
  });

  it('shows ad-hoc panes opened by the user', () => {
    const tmuxPanes = [
      makeTmuxPane('%0', 'bash', 'bash'),
      makeTmuxPane('%1', 'AA822972-1', 'claude'),
      makeTmuxPane('%4', 'my-scratch', 'node'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1');
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('orchestrator');
    expect(items[1]!.label).toBe('my-scratch');
    expect(items[1]!.badge).toBe('[node]');
    expect(items[1]!.status).toBeNull();
  });
});
