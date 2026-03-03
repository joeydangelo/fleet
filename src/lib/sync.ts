import { resolve, join, dirname } from 'node:path';
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  cpSync,
  copyFileSync,
} from 'node:fs';
import { writeFileSync } from 'atomically';
import { git } from './git.js';
import { toErrorMessage } from './output.js';
import { SYNC_BRANCH } from './constants.js';
const STATE_FILE = 'state.json';
const MAX_RETRIES = 3;

/** Lifecycle status and metadata for a single task in the sync state. */
export interface TaskState {
  status: 'pending' | 'in_progress' | 'in_review' | 'done';
  claimed?: string;
  doneAt?: string;
  focus?: string[];
  reviewCycle?: number;
}

/** Exhaustive check: returns true only for statuses where the task is fully complete. */
export function isTerminalStatus(status: TaskState['status']): boolean {
  switch (status) {
    case 'done':
      return true;
    case 'pending':
    case 'in_progress':
    case 'in_review':
      return false;
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled task status: ${String(exhaustive)}`);
    }
  }
}

type MergeStatus = 'pending' | 'merged' | 'skipped' | 'conflict';

/** Per-task merge tracking: whether a task branch was merged, skipped, or hit a conflict. */
export interface MergeEntry {
  status: MergeStatus;
  /** ISO timestamp when merged clean. */
  merged?: string;
  /** Path to conflict brief on sync branch. */
  brief?: string;
}

/** Session coordination state on the paw-sync branch. Tracks task statuses, merge progress, and journal cursors. */
export interface SyncState {
  session: string;
  config: string;
  target: string;
  tasks: Record<string, TaskState>;
  merges?: Record<string, MergeEntry>;
  /** Per-task timestamp of last message read, written by `paw prime`. */
  lastCheck?: Record<string, string>;
  /** When true, `paw review` auto-completes without spawning a reviewer. Set by `paw go --no-review`. */
  skipReview?: boolean;
}

function syncBranchExists(cwd?: string): boolean {
  try {
    git(['rev-parse', '--verify', SYNC_BRANCH], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree at .paw/sync/ for the paw-sync branch.
 * If no branch exists, creates an orphan worktree.
 * Idempotent: returns immediately if the worktree already exists.
 */
export function initSyncWorktree(cwd: string): string {
  const worktreePath = resolve(cwd, '.paw', 'sync');

  if (existsSync(join(worktreePath, '.git'))) {
    return worktreePath;
  }

  rmSync(worktreePath, { recursive: true, force: true });

  if (syncBranchExists(cwd)) {
    git(['worktree', 'add', worktreePath, SYNC_BRANCH], {
      cwd,
      stdio: 'pipe',
    });
  } else {
    git(['worktree', 'add', '--orphan', '-b', SYNC_BRANCH, worktreePath], {
      cwd,
      stdio: 'pipe',
    });
  }

  return worktreePath;
}

/**
 * Resolve the absolute path to .paw/sync/ from any worktree.
 * Agents run in task worktrees (-paw-auth, -paw-api) but the sync
 * worktree lives in the main repo. This uses git-common-dir to find
 * the shared .git path and derives the main worktree from it.
 *
 * Memoized per-process — safe because paw runs as a short-lived CLI.
 */
const syncDirCache = new Map<string, string>();

export function resolveSyncDir(cwd: string): string {
  const cached = syncDirCache.get(cwd);
  if (cached) return cached;

  const gitCommonDir = git(['rev-parse', '--git-common-dir'], {
    cwd,
    stdio: 'pipe',
  });
  const mainRoot = resolve(cwd, gitCommonDir, '..');
  const result = resolve(mainRoot, '.paw', 'sync');
  syncDirCache.set(cwd, result);
  return result;
}

/**
 * Remove the sync worktree at .paw/sync/.
 * Idempotent: no error if no worktree exists.
 */
export function removeSyncWorktree(cwd: string): void {
  const worktreePath = resolve(cwd, '.paw', 'sync');

  try {
    git(['worktree', 'remove', '--force', worktreePath], {
      cwd,
      stdio: 'pipe',
    });
  } catch {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    git(['worktree', 'prune'], { cwd, stdio: 'pipe' });
  } catch {
    // Prune failure is non-critical — stale refs get cleaned next session
  }
}

/**
 * Stage all changes in the sync worktree and commit with retry.
 * Retries on index.lock contention (concurrent multi-agent writes).
 */
function commitSyncChanges(syncDir: string, message: string): void {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      git(['add', '-A'], { cwd: syncDir, stdio: 'pipe' });
      git(['commit', '--allow-empty', '-m', message], {
        cwd: syncDir,
        stdio: 'pipe',
      });
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed to commit sync changes after ${MAX_RETRIES} attempts: ${toErrorMessage(err)}`,
        );
      }
    }
  }
}

/** Read and parse the sync state from the sync worktree, or null if unavailable. */
export function readSyncState(cwd?: string): SyncState | null {
  try {
    const syncDir = resolveSyncDir(cwd ?? process.cwd());
    const raw = readFileSync(resolve(syncDir, STATE_FILE), 'utf-8');
    return JSON.parse(raw) as SyncState;
  } catch {
    return null;
  }
}

/** Read a file from the sync worktree by relative path, or null if missing. */
export function readSyncFile(path: string, cwd?: string): string | null {
  try {
    const syncDir = resolveSyncDir(cwd ?? process.cwd());
    return readFileSync(resolve(syncDir, path), 'utf-8');
  } catch {
    return null;
  }
}

/** List files under a directory prefix in the sync worktree. */
export function listSyncDir(prefix: string, cwd?: string): string[] {
  try {
    const syncDir = resolveSyncDir(cwd ?? process.cwd());
    const dir = resolve(syncDir, prefix);
    const entries = readdirSync(dir);
    return entries.map((e) => `${prefix}/${e}`);
  } catch {
    return [];
  }
}

/** Write sync state to the sync worktree and commit. */
export function writeSyncState(state: SyncState, cwd?: string): void {
  const syncDir = resolveSyncDir(cwd ?? process.cwd());
  writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  commitSyncChanges(syncDir, 'paw: update sync state');
}

/** Write sync state and additional files in one atomic commit. */
export function writeSyncStateAndFiles(
  state: SyncState,
  files: Array<{ path: string; content: string }>,
  cwd?: string,
): void {
  const syncDir = resolveSyncDir(cwd ?? process.cwd());
  writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  for (const file of files) {
    const filePath = resolve(syncDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  commitSyncChanges(syncDir, 'paw: update sync state');
}

/** Write a single file to the sync worktree and commit. */
export function writeSyncFile(path: string, content: string, cwd?: string): void {
  const syncDir = resolveSyncDir(cwd ?? process.cwd());
  const filePath = resolve(syncDir, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  commitSyncChanges(syncDir, `paw: update ${path}`);
}

/** Build the initial `SyncState` for a new session from task names and config. */
export function initSyncState(
  target: string,
  taskNames: string[],
  configPath: string,
  focusMap?: Record<string, string[]>,
): SyncState {
  const tasks: Record<string, TaskState> = {};
  for (const name of taskNames) {
    const focus = focusMap?.[name];
    tasks[name] = { status: 'pending', ...(focus ? { focus } : {}) };
  }

  return {
    session: new Date().toISOString(),
    config: configPath,
    target,
    tasks,
  };
}

/** Transition a task to `in_progress` with a claimed timestamp. */
export function claimTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: 'in_progress',
        claimed: new Date().toISOString(),
      },
    },
  };
}

/** Transition a task to `in_review` and increment its review cycle counter. */
export function submitForReview(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: 'in_review',
        reviewCycle: (task.reviewCycle ?? 0) + 1,
      },
    },
  };
}

/** Transition a task to `done` with a completion timestamp. */
export function completeTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: 'done',
        doneAt: new Date().toISOString(),
      },
    },
  };
}

/** Revert a task back to `in_progress` (e.g. after a failed review). */
export function reopenTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: 'in_progress',
      },
    },
  };
}

/** Create the initial merge tracking map with all tasks set to `pending`. */
export function initMergeState(taskNames: string[]): Record<string, MergeEntry> {
  const merges: Record<string, MergeEntry> = {};
  for (const name of taskNames) {
    merges[name] = { status: 'pending' };
  }
  return merges;
}

/** Replace the merge entry for a single task in the sync state. */
export function updateMergeEntry(state: SyncState, taskName: string, entry: MergeEntry): SyncState {
  return {
    ...state,
    merges: {
      ...state.merges,
      [taskName]: entry,
    },
  };
}

/**
 * Archive the sync worktree contents to .paw/sessions/<date>-<target>/.
 * Copies state.json, journal/, conflicts/, and paw.yaml.
 * Returns the archive path, or null if nothing to archive.
 */
export function archiveSession(repoRoot: string, target: string): string | null {
  const syncDir = resolve(repoRoot, '.paw', 'sync');
  if (!existsSync(syncDir)) return null;

  const stateFile = resolve(syncDir, STATE_FILE);
  if (!existsSync(stateFile)) return null;

  let datePrefix: string;
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as SyncState;
    datePrefix = state.session.slice(0, 10);
  } catch {
    datePrefix = new Date().toISOString().slice(0, 10);
  }

  const sanitized = target.replace(/\//g, '-');
  const archiveDir = resolve(repoRoot, '.paw', 'sessions', `${datePrefix}-${sanitized}`);
  mkdirSync(archiveDir, { recursive: true });

  copyFileSync(stateFile, resolve(archiveDir, 'state.json'));

  for (const dir of ['journal', 'review', 'conflicts']) {
    const src = resolve(syncDir, dir);
    if (existsSync(src)) {
      cpSync(src, resolve(archiveDir, dir), { recursive: true });
    }
  }

  const configPath = resolve(repoRoot, '.paw', 'paw.yaml');
  if (existsSync(configPath)) {
    copyFileSync(configPath, resolve(archiveDir, 'paw.yaml'));
  }

  return archiveDir;
}
