import { describe, it, expect } from 'vitest';
import { buildDisplayItems } from '../src/components/tui-app.js';
import type { TmuxPaneInfo, FleetPane } from '../src/lib/tmux.js';

function makeTmuxPane(
  paneId: string,
  title: string,
  command: string,
  cwd: string,
  project: string,
  role = '',
): TmuxPaneInfo {
  return { paneId, title, command, cwd, project, role };
}

function makeTaskPane(overrides: Partial<FleetPane> = {}): FleetPane {
  return {
    id: 'fleet-1',
    paneId: '%2',
    taskName: 'auth',
    worktreePath: '/home/user/myapp/.fleet/worktrees/auth',
    branchName: 'feature-auth',
    ...overrides,
  };
}

describe('buildDisplayItems — single project', () => {
  it('shows no project headers for single-project session', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane(
        '%2',
        'fleet-auth',
        'claude',
        '/home/user/myapp/.fleet/worktrees/auth',
        '/home/user/myapp',
      ),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(
      tmuxPanes,
      taskPanes,
      null,
      '%0',
      '%1',
      '/home/user/myapp',
      null,
    );
    expect(items.every((item) => !item.projectHeader)).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('preserves existing ordering: orchestrator, task panes, ad-hoc', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane(
        '%2',
        'fleet-auth',
        'claude',
        '/home/user/myapp/.fleet/worktrees/auth',
        '/home/user/myapp',
      ),
      makeTmuxPane('%3', 'bash', 'bash', '/home/user/myapp', ''),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(
      tmuxPanes,
      taskPanes,
      null,
      '%0',
      '%1',
      '/home/user/myapp',
      null,
    );
    expect(items[0]!.label).toBe('orchestrator');
    expect(items[1]!.label).toBe('auth');
    expect(items[2]!.label).toContain('pane');
  });
});

describe('buildDisplayItems — multi-project grouping', () => {
  it('adds project headers when 2+ projects exist', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'fleet-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    expect(items).toHaveLength(2);
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBe('other');
  });

  it('groups ad-hoc panes by resolved cwd git root', () => {
    // Ad-hoc pane has no @fleet_project but its cwd resolves to /home/user/myapp
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'fleet-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
      // Ad-hoc pane with project="" — will be resolved by resolveGitRoot(cwd)
      // In tests, cwd may not actually be a git repo, so it resolves to null → ungrouped
      makeTmuxPane('%6', 'bash', 'bash', '/tmp', ''),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    // Managed panes get headers, ungrouped pane gets red warning header
    expect(items).toHaveLength(3);
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBe('other');
    expect(items[2]!.projectHeader).toBe('not a git repo');
    expect(items[2]!.headerColor).toBe('red');
  });

  it('managed panes use @fleet_project regardless of cwd', () => {
    // Task pane's cwd is in a worktree, but @fleet_project is the main repo
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%2', 'fleet-auth', 'claude', '/some/worktree/path', '/home/user/myapp'),
      makeTmuxPane('%5', 'fleet-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(
      tmuxPanes,
      taskPanes,
      null,
      '%0',
      '%1',
      '/home/user/myapp',
      null,
    );
    // Both myapp panes grouped under myapp
    const myappItems = items.filter((i) => i.paneId === '%1' || i.paneId === '%2');
    expect(myappItems).toHaveLength(2);
    // Only the first item in the myapp group has the header
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBeUndefined();
  });

  it('excludes control pane from display', () => {
    const tmuxPanes = [
      makeTmuxPane('%0', 'fleet-tui', 'node', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    expect(items).toHaveLength(1);
    expect(items[0]!.paneId).toBe('%1');
  });
});

describe('buildDisplayItems — worktree panes group with primary project', () => {
  it('task panes without @fleet_project use primaryProject, not cwd resolution', () => {
    // Worktree panes have cwd in sibling dirs with their own .git files.
    // Without @fleet_project, they must fall back to primaryProject — not
    // resolveGitRoot(cwd) which would treat each worktree as a separate project.
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/fleet-test', ''),
      makeTmuxPane('%2', 'fleet-auth', 'claude', '/home/user/fleet-test-fleet-auth', ''),
      makeTmuxPane('%3', 'fleet-api', 'claude', '/home/user/fleet-test-fleet-api', ''),
    ];
    const taskPanes = [
      makeTaskPane({ paneId: '%2', taskName: 'auth' }),
      makeTaskPane({ id: 'fleet-2', paneId: '%3', taskName: 'api' }),
    ];
    const items = buildDisplayItems(
      tmuxPanes,
      taskPanes,
      null,
      '%0',
      '%1',
      '/home/user/fleet-test',
      null,
    );
    // All 3 panes should be in the same project group — no headers (single project)
    expect(items).toHaveLength(3);
    expect(items.every((item) => !item.projectHeader)).toBe(true);
  });

  it('task panes with @fleet_project set use that over cwd', () => {
    const tmuxPanes = [
      makeTmuxPane(
        '%1',
        'fleet-orchestrator',
        'claude',
        '/home/user/fleet-test',
        '/home/user/fleet-test',
      ),
      makeTmuxPane(
        '%2',
        'fleet-auth',
        'claude',
        '/home/user/fleet-test-fleet-auth',
        '/home/user/fleet-test',
      ),
    ];
    const taskPanes = [makeTaskPane({ paneId: '%2', taskName: 'auth' })];
    const items = buildDisplayItems(
      tmuxPanes,
      taskPanes,
      null,
      '%0',
      '%1',
      '/home/user/fleet-test',
      null,
    );
    expect(items).toHaveLength(2);
    expect(items.every((item) => !item.projectHeader)).toBe(true);
  });
});

describe('buildDisplayItems — addProject duplicate detection', () => {
  it('creates display items for new project panes', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'fleet-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'fleet-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    expect(items).toHaveLength(2);
    expect(items[1]!.label).toBe('orchestrator');
  });
});

describe('buildDisplayItems — orchestrator role detection', () => {
  it('labels ad-hoc pane as orchestrator when @fleet_role is set, even if title is stomped', () => {
    const tmuxPanes = [
      makeTmuxPane(
        '%1',
        'fleet-orchestrator',
        'claude',
        '/home/user/myapp',
        '/home/user/myapp',
        'fleet-orchestrator',
      ),
      // Added project: title stomped by Claude Code, but @fleet_role is still set
      makeTmuxPane(
        '%5',
        'Claude Code',
        'claude',
        '/home/user/other',
        '/home/user/other',
        'fleet-orchestrator',
      ),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    expect(items).toHaveLength(2);
    expect(items[0]!.label).toBe('orchestrator'); // primary — hardcoded
    expect(items[1]!.label).toBe('orchestrator'); // added project — detected by role
  });

  it('labels ad-hoc pane by title when @fleet_role is not set', () => {
    const tmuxPanes = [
      makeTmuxPane(
        '%1',
        'fleet-orchestrator',
        'claude',
        '/home/user/myapp',
        '/home/user/myapp',
        'fleet-orchestrator',
      ),
      makeTmuxPane('%5', 'my-shell', 'bash', '/home/user/other', '/home/user/other'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp', null);
    expect(items[1]!.label).toBe('my-shell');
  });
});
