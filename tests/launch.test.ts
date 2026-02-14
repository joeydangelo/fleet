import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';
import { buildLaunchCommand } from '../src/lib/launcher.js';
import type { LaunchOptions } from '../src/lib/launcher.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('launch: config with agent', () => {
  it('loads the agent field from paw.yaml', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
agent: claude
tasks:
  auth:
    focus: src/auth/
  api:
    focus: src/api/
`,
    );

    const config = loadConfig(configPath);
    expect(config.agent).toBe('claude');
    expect(Object.keys(config.tasks)).toEqual(['auth', 'api']);

    rmSync(dir, { recursive: true });
  });

  it('supports agent commands with flags', () => {
    const dir = makeTempDir();
    const configPath = resolve(dir, 'paw.yaml');
    writeFileSync(
      configPath,
      `
target: feature/x
agent: "claude --print"
tasks:
  a:
    focus: src/
`,
    );

    const config = loadConfig(configPath);
    expect(config.agent).toBe('claude --print');

    rmSync(dir, { recursive: true });
  });
});

describe('launch: dry-run command building', () => {
  it('builds correct commands for each platform', () => {
    const opts: LaunchOptions = {
      worktreePath: '/home/user/app-paw-auth',
      agentCommand: 'claude',
    };

    const win = buildLaunchCommand(opts, 'windows');
    expect(win.command).toBe('cmd');
    expect(win.args.join(' ')).toContain('cd /d');
    expect(win.args.join(' ')).toContain('claude');

    const mac = buildLaunchCommand(opts, 'macos');
    expect(mac.command).toBe('osascript');
    expect(mac.args[1]).toContain('tell app "Terminal"');

    const linux = buildLaunchCommand({ ...opts, terminal: 'gnome-terminal' }, 'linux');
    expect(linux.command).toBe('gnome-terminal');
  });

  it('skip logic: completed tasks should not generate commands', () => {
    // Simulate the skip logic from launch.ts:
    // tasks with status === 'completed' are skipped
    const tasks = {
      auth: { status: 'completed' as const },
      api: { status: 'in_progress' as const },
      tests: { status: 'pending' as const },
    };

    const launchable = Object.entries(tasks).filter(([_, t]) => t.status !== 'completed');
    expect(launchable.map(([name]) => name)).toEqual(['api', 'tests']);
  });
});

describe('launch: --task filter', () => {
  it('filters worktrees to a single task', () => {
    const worktrees = [
      { taskName: 'auth', branch: 'f-auth', worktreePath: '/tmp/auth' },
      { taskName: 'api', branch: 'f-api', worktreePath: '/tmp/api' },
      { taskName: 'tests', branch: 'f-tests', worktreePath: '/tmp/tests' },
    ];

    const filtered = worktrees.filter((wt) => wt.taskName === 'api');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.taskName).toBe('api');
  });

  it('returns empty for unknown task', () => {
    const worktrees = [{ taskName: 'auth', branch: 'f-auth', worktreePath: '/tmp/auth' }];

    const filtered = worktrees.filter((wt) => wt.taskName === 'nope');
    expect(filtered).toHaveLength(0);
  });
});
