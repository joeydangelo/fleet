import { describe, it, expect } from 'vitest';
import { buildDisplayItems } from '../src/components/tui-app.js';
import type { TmuxPaneInfo, PawPane } from '../src/lib/tmux.js';

function makeTmuxPane(
  paneId: string,
  title: string,
  command: string,
  cwd: string,
  project: string,
): TmuxPaneInfo {
  return { paneId, title, command, cwd, project };
}

function makeTaskPane(overrides: Partial<PawPane> = {}): PawPane {
  return {
    id: 'paw-1',
    paneId: '%2',
    taskName: 'auth',
    worktreePath: '/home/user/myapp/.paw/worktrees/auth',
    agent: 'claude',
    branchName: 'feature-auth',
    ...overrides,
  };
}

describe('buildDisplayItems — single project', () => {
  it('shows no project headers for single-project session', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane(
        '%2',
        'paw-auth',
        'claude',
        '/home/user/myapp/.paw/worktrees/auth',
        '/home/user/myapp',
      ),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '%1', '/home/user/myapp');
    expect(items.every((item) => !item.projectHeader)).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('preserves existing ordering: orchestrator, task panes, ad-hoc', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane(
        '%2',
        'paw-auth',
        'claude',
        '/home/user/myapp/.paw/worktrees/auth',
        '/home/user/myapp',
      ),
      makeTmuxPane('%3', 'bash', 'bash', '/home/user/myapp', ''),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '%1', '/home/user/myapp');
    expect(items[0]!.label).toBe('orchestrator');
    expect(items[1]!.label).toBe('auth');
    expect(items[2]!.label).toContain('pane');
  });
});

describe('buildDisplayItems — multi-project grouping', () => {
  it('adds project headers when 2+ projects exist', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'paw-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp');
    expect(items).toHaveLength(2);
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBe('other');
  });

  it('groups ad-hoc panes by resolved cwd git root', () => {
    // Ad-hoc pane has no @paw_project but its cwd resolves to /home/user/myapp
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'paw-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
      // Ad-hoc pane with project="" — will be resolved by resolveGitRoot(cwd)
      // In tests, cwd may not actually be a git repo, so it resolves to null → ungrouped
      makeTmuxPane('%6', 'bash', 'bash', '/tmp', ''),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp');
    // Managed panes get headers, ungrouped pane goes to bottom
    expect(items).toHaveLength(3);
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBe('other');
    expect(items[2]!.projectHeader).toBeUndefined();
  });

  it('managed panes use @paw_project regardless of cwd', () => {
    // Task pane's cwd is in a worktree, but @paw_project is the main repo
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%2', 'paw-auth', 'claude', '/some/worktree/path', '/home/user/myapp'),
      makeTmuxPane('%5', 'paw-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const taskPanes = [makeTaskPane()];
    const items = buildDisplayItems(tmuxPanes, taskPanes, null, '%0', '%1', '/home/user/myapp');
    // Both myapp panes grouped under myapp
    const myappItems = items.filter((i) => i.paneId === '%1' || i.paneId === '%2');
    expect(myappItems).toHaveLength(2);
    // Only the first item in the myapp group has the header
    expect(items[0]!.projectHeader).toBe('myapp');
    expect(items[1]!.projectHeader).toBeUndefined();
  });

  it('excludes control pane from display', () => {
    const tmuxPanes = [
      makeTmuxPane('%0', 'paw-tui', 'node', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp');
    expect(items).toHaveLength(1);
    expect(items[0]!.paneId).toBe('%1');
  });
});

describe('buildDisplayItems — addProject duplicate detection', () => {
  it('creates display items for new project panes', () => {
    const tmuxPanes = [
      makeTmuxPane('%1', 'paw-orchestrator', 'claude', '/home/user/myapp', '/home/user/myapp'),
      makeTmuxPane('%5', 'paw-orchestrator', 'claude', '/home/user/other', '/home/user/other'),
    ];
    const items = buildDisplayItems(tmuxPanes, [], null, '%0', '%1', '/home/user/myapp');
    expect(items).toHaveLength(2);
    expect(items[1]!.label).toBe('orchestrator');
  });
});
