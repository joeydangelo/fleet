import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeTempDir } from './temp.js';

interface FixtureOptions {
  taskName?: string;
  branch?: string;
  target?: string;
  tasks?: Record<string, { status: string; [key: string]: unknown }>;
}

interface FixtureRepo {
  repoRoot: string;
  syncDir: string;
  cleanup: () => void;
  writeSyncState: (state: Record<string, unknown>) => void;
  readSyncFile: (path: string) => string | null;
  readSyncState: () => Record<string, unknown> | null;
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * Create a temp git repo with paw task files and an initialized sync worktree.
 * Designed for integration tests that exercise real sync operations.
 */
export function createFixtureRepo(opts?: FixtureOptions): FixtureRepo {
  const taskName = opts?.taskName ?? 'auth';
  const branch = opts?.branch ?? `fix/test-theatre-rewrite-${taskName}`;
  const target = opts?.target ?? 'main';
  const tasks = opts?.tasks ?? { [taskName]: { status: 'in_progress' } };

  const repoRoot = makeTempDir();

  // Init repo with initial commit
  gitIn(repoRoot, ['init', '-b', 'main']);
  gitIn(repoRoot, ['config', 'user.email', 'test@test.com']);
  gitIn(repoRoot, ['config', 'user.name', 'Test']);

  // Create .paw/paw.yaml
  const pawDir = resolve(repoRoot, '.paw');
  mkdirSync(pawDir, { recursive: true });
  writeFileSync(
    resolve(pawDir, 'paw.yaml'),
    `target: ${target}\ntasks:\n  ${taskName}:\n    focus:\n      - "tests/${taskName}.test.ts"\n`,
  );

  // Create .paw/tasks/<name>.md
  const tasksDir = resolve(pawDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(resolve(tasksDir, `${taskName}.md`), `# Task: ${taskName}\n`);

  // Initial commit
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-m', 'init']);

  // Create task branch
  gitIn(repoRoot, ['checkout', '-b', branch]);

  // Create sync worktree on orphan paw-sync branch
  const syncDir = resolve(repoRoot, '.paw', 'sync');
  gitIn(repoRoot, ['worktree', 'add', '--orphan', '-b', 'paw-sync', syncDir]);

  // Write state.json
  const state = {
    session: new Date().toISOString(),
    config: '.paw/paw.yaml',
    target,
    tasks,
  };
  writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');

  // Create review directory
  mkdirSync(resolve(syncDir, 'review'), { recursive: true });

  // Commit sync state
  gitIn(syncDir, ['add', '-A']);
  gitIn(syncDir, ['commit', '-m', 'init sync state']);

  function cleanup(): void {
    try {
      gitIn(repoRoot, ['worktree', 'remove', '--force', syncDir]);
    } catch {
      // fallback
    }
    rmSync(repoRoot, { recursive: true, force: true });
  }

  function writeSyncState(s: Record<string, unknown>): void {
    writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(s, null, 2) + '\n');
    gitIn(syncDir, ['add', '-A']);
    gitIn(syncDir, ['commit', '--allow-empty', '-m', 'update state']);
  }

  function readSyncFile(path: string): string | null {
    try {
      return readFileSync(resolve(syncDir, path), 'utf-8');
    } catch {
      return null;
    }
  }

  function readSyncState(): Record<string, unknown> | null {
    const content = readSyncFile('state.json');
    if (!content) return null;
    return JSON.parse(content) as Record<string, unknown>;
  }

  return { repoRoot, syncDir, cleanup, writeSyncState, readSyncFile, readSyncState };
}
