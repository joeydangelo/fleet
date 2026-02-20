import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLaunchCommand, readPidFile, writePidFile } from '../src/lib/launcher.js';
import type { LaunchOptions } from '../src/lib/launcher.js';

describe('launch: dry-run command building', () => {
  it('builds correct commands for each platform', () => {
    const opts: LaunchOptions = {
      worktreePath: '/home/user/app-paw-auth',
      agentCommand: 'claude',
    };

    const win = buildLaunchCommand(opts, 'windows');
    expect(win.command).toBe('cmd');
    expect(win.args.join(' ')).toContain('/d');
    expect(win.args.join(' ')).toContain('cmd /k claude');

    const mac = buildLaunchCommand(opts, 'macos');
    expect(mac.command).toBe('osascript');
    expect(mac.args[1]).toContain('tell app "Terminal"');

    const linux = buildLaunchCommand({ ...opts, terminal: 'gnome-terminal' }, 'linux');
    expect(linux.command).toBe('gnome-terminal');
  });

  it('skip logic: done tasks should not generate commands', () => {
    // Simulate the skip logic from launch.ts:
    // tasks with status === 'done' are skipped
    const tasks = {
      auth: { status: 'done' as const },
      api: { status: 'in_progress' as const },
      tests: { status: 'pending' as const },
    };

    const launchable = Object.entries(tasks).filter(([_, t]) => t.status !== 'done');
    expect(launchable.map(([name]) => name)).toEqual(['api', 'tests']);
  });
});

describe('launch: PID tracking integration', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function makeTempRepo(): string {
    const dir = resolve(
      tmpdir(),
      `paw-pid-launch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(resolve(dir, '.paw'), { recursive: true });
    dirs.push(dir);
    return dir;
  }

  it('re-launch appends to existing pids.json rather than overwriting', () => {
    const repo = makeTempRepo();

    // Simulate first launch wrote some PIDs
    writePidFile(repo, { auth: 1111 });

    // Simulate second launch: read existing, add new
    const existing = readPidFile(repo);
    existing['api'] = 2222;
    writePidFile(repo, existing);

    const result = readPidFile(repo);
    expect(result).toEqual({ auth: 1111, api: 2222 });
  });

  it('re-launch updates PID for re-launched task', () => {
    const repo = makeTempRepo();

    writePidFile(repo, { auth: 1111, api: 2222 });

    // Simulate re-launching auth: the PID changes
    const existing = readPidFile(repo);
    existing['auth'] = 3333;
    writePidFile(repo, existing);

    const result = readPidFile(repo);
    expect(result).toEqual({ auth: 3333, api: 2222 });
  });
});
