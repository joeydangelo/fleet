import { resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempDir } from './temp.js';
import type { SyncState, TaskState } from '../../src/lib/sync.js';
import { SYNC_BRANCH } from '../../src/lib/constants.js';

/** A single task definition for paw.yaml. */
export interface FixtureTaskDef {
  focus: string | string[];
  prompt?: string;
}

/** Options for creating a fixture repo. */
export interface FixtureRepoOptions {
  /** Task definitions. Default: single "auth" task with focus "src/auth.ts". */
  tasks?: Record<string, FixtureTaskDef>;
  /** Override initial sync state fields (tasks statuses, reviewCycle, etc.). */
  syncState?: {
    tasks?: Record<string, Partial<TaskState>>;
  };
  /** Override raw paw.yaml content (bypasses task-based generation). */
  pawYaml?: string;
}

/** Object returned by createFixtureRepo with paths and convenience methods. */
export interface FixtureRepo {
  repoRoot: string;
  syncDir: string;
  cleanup: () => void;
  writeSyncState: (state: SyncState) => void;
  readSyncFile: (path: string) => string | null;
  readSyncState: () => SyncState | null;
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/**
 * Create a minimal real git repo in a temp directory for integration tests.
 * Sets up .paw/paw.yaml, task files, sync worktree with state.json, and review/ directory.
 */
export function createFixtureRepo(opts?: FixtureRepoOptions): FixtureRepo {
  const repoRoot = makeTempDir();
  const tasks = opts?.tasks ?? { auth: { focus: 'src/auth.ts' } };
  const taskNames = Object.keys(tasks);
  const target = 'fix/test-target';

  // Init git repo with user config
  gitIn(repoRoot, ['init']);
  gitIn(repoRoot, ['config', 'user.email', 'test@test.com']);
  gitIn(repoRoot, ['config', 'user.name', 'Test User']);

  // Write .paw/paw.yaml
  const pawDir = resolve(repoRoot, '.paw');
  mkdirSync(pawDir, { recursive: true });

  const pawYamlPath = resolve(pawDir, 'paw.yaml');
  if (opts?.pawYaml) {
    writeFileSync(pawYamlPath, opts.pawYaml);
  } else {
    const pawConfig = {
      target,
      tasks: Object.fromEntries(
        Object.entries(tasks).map(([name, def]) => [
          name,
          { focus: def.focus, ...(def.prompt ? { prompt: def.prompt } : {}) },
        ]),
      ),
    };
    writeFileSync(pawYamlPath, stringifyYaml(pawConfig));
  }

  // Write .paw/tasks/<name>.md for each task
  const tasksDir = resolve(pawDir, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  for (const name of taskNames) {
    writeFileSync(resolve(tasksDir, `${name}.md`), `# Task: ${name}\n`);
  }

  // Initial commit
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-m', 'initial commit']);

  // Init sync worktree on paw-sync branch
  const syncDir = resolve(pawDir, 'sync');
  gitIn(repoRoot, ['worktree', 'add', '--orphan', '-b', SYNC_BRANCH, syncDir]);

  // Build initial sync state
  const syncTasks: Record<string, TaskState> = {};
  for (const name of taskNames) {
    syncTasks[name] = {
      status: 'in_progress',
      claimed: new Date().toISOString(),
      ...opts?.syncState?.tasks?.[name],
    };
  }

  const state: SyncState = {
    session: new Date().toISOString(),
    config: '.paw/paw.yaml',
    target,
    tasks: syncTasks,
  };

  // Write state.json and create review/ directory in sync worktree
  writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  mkdirSync(resolve(syncDir, 'review'), { recursive: true });

  // Commit sync worktree contents
  gitIn(syncDir, ['add', '-A']);
  gitIn(syncDir, ['commit', '-m', 'paw: init sync state']);

  // Convenience methods
  const writeSyncState = (s: SyncState): void => {
    writeFileSync(resolve(syncDir, 'state.json'), JSON.stringify(s, null, 2) + '\n');
    gitIn(syncDir, ['add', '-A']);
    gitIn(syncDir, ['commit', '--allow-empty', '-m', 'paw: update sync state']);
  };

  const readSyncFile = (path: string): string | null => {
    const resolved = resolve(syncDir, path);
    if (!resolved.startsWith(syncDir)) return null;
    try {
      return readFileSync(resolved, 'utf-8');
    } catch {
      return null;
    }
  };

  const readSyncStateLocal = (): SyncState | null => {
    const raw = readSyncFile('state.json');
    if (!raw) return null;
    return JSON.parse(raw) as SyncState;
  };

  const cleanup = (): void => {
    try {
      gitIn(repoRoot, ['worktree', 'remove', '--force', syncDir]);
    } catch {
      // worktree may already be removed
    }
    rmSync(repoRoot, { recursive: true, force: true });
  };

  return {
    repoRoot,
    syncDir,
    cleanup,
    writeSyncState,
    readSyncFile,
    readSyncState: readSyncStateLocal,
  };
}
