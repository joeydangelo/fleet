import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'atomically';
import type { SyncState } from '../../src/lib/sync.js';
import { makeTempDir } from './temp.js';

/** Result of createFixtureRepo — everything tests need to interact with the fixture. */
export interface FixtureRepo {
  repoRoot: string;
  syncDir: string;
  cleanup: () => void;
  writeSyncState: (state: SyncState) => void;
  readSyncFile: (path: string) => string | null;
  readSyncState: () => SyncState;
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * Create a minimal git repo fixture with sync worktree for integration tests.
 *
 * Sets up:
 * - git init with user config + initial commit
 * - .paw/paw.yaml with a single task (default: "auth")
 * - .paw/tasks/<taskName>.md (enables detectTaskName)
 * - paw-sync orphan branch with worktree at .paw/sync/
 * - state.json committed in the sync worktree
 * - review/ directory in sync worktree
 */
export function createFixtureRepo(opts?: { taskName?: string; state?: SyncState }): FixtureRepo {
  const taskName = opts?.taskName ?? 'auth';
  const repoRoot = makeTempDir();
  const syncDir = resolve(repoRoot, '.paw', 'sync');

  // Init repo with user config
  gitIn(repoRoot, ['init']);
  gitIn(repoRoot, ['config', 'user.email', 'test@test.com']);
  gitIn(repoRoot, ['config', 'user.name', 'Test']);

  // Create .paw/paw.yaml
  mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  writeFileSync(
    resolve(repoRoot, '.paw', 'paw.yaml'),
    `target: feature/x\ntasks:\n  ${taskName}:\n    focus:\n      - src/\n`,
  );

  // Create .paw/tasks/<taskName>.md
  mkdirSync(resolve(repoRoot, '.paw', 'tasks'), { recursive: true });
  writeFileSync(resolve(repoRoot, '.paw', 'tasks', `${taskName}.md`), `# Task: ${taskName}\n`);

  // Initial commit
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-m', 'initial']);

  // Create the task branch so getCurrentBranch returns something useful
  gitIn(repoRoot, ['checkout', '-b', `feature/x-${taskName}`]);

  // Create sync worktree on orphan paw-sync branch
  gitIn(repoRoot, ['worktree', 'add', '--orphan', '-b', 'paw-sync', syncDir]);

  // Create review directory
  mkdirSync(resolve(syncDir, 'review'), { recursive: true });

  // Write initial state.json
  const defaultState: SyncState = opts?.state ?? {
    session: 'test-session',
    config: resolve(repoRoot, '.paw', 'paw.yaml'),
    target: 'feature/x',
    tasks: {
      [taskName]: { status: 'in_progress', claimed: '2026-03-01T00:00:00Z' },
    },
  };

  writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(defaultState, null, 2) + '\n');
  gitIn(syncDir, ['add', '-A']);
  gitIn(syncDir, ['commit', '-m', 'init sync state']);

  return {
    repoRoot,
    syncDir,
    cleanup: () => {
      try {
        gitIn(repoRoot, ['worktree', 'remove', '--force', syncDir]);
      } catch {
        /* ignore */
      }
      rmSync(repoRoot, { recursive: true, force: true });
    },
    writeSyncState: (state: SyncState) => {
      writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
      gitIn(syncDir, ['add', '-A']);
      gitIn(syncDir, ['commit', '--allow-empty', '-m', 'update sync state']);
    },
    readSyncFile: (path: string): string | null => {
      try {
        return readFileSync(resolve(syncDir, path), 'utf-8');
      } catch {
        return null;
      }
    },
    readSyncState: (): SyncState => {
      const raw = readFileSync(resolve(syncDir, 'state.json'), 'utf-8');
      return JSON.parse(raw) as SyncState;
    },
  };
}
