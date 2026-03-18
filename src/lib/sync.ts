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
import { z } from 'zod';
import { git } from './git.js';
import { toErrorMessage, requireSyncState } from './output.js';
import { CLIError, NotFoundError, ExternalCommandError } from './errors.js';
import { SYNC_BRANCH } from './constants.js';
import { detectTaskName } from './session.js';
import { sanitizeBranchName } from './util.js';
const STATE_FILE = 'state.json';
const MAX_RETRIES = 3;

/** Lifecycle status and metadata for a single task in the sync state. */
export interface TaskState {
  status: 'pending' | 'in_progress' | 'in_review' | 'done';
  claimed?: string;
  doneAt?: string;
  focus?: string[];
  /** Always initialized to 0; incremented by submitForReview. */
  reviewCycle?: number;
  verdict?: 'pass' | 'fail' | 'skip';
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
      throw new CLIError(`Unhandled task status: ${String(exhaustive)}`);
    }
  }
}

/** Per-task merge tracking: whether a task branch was merged, skipped, or hit a conflict. */
export type MergeEntry =
  | { status: 'pending' | 'skipped' }
  | { status: 'merged'; merged: string }
  | { status: 'conflict'; brief: string };

/** Session coordination state on the fleet-sync branch. Tracks task statuses, merge progress, and inbox cursors. */
export interface SyncState {
  session: string;
  config: string;
  target: string;
  tasks: Record<string, TaskState>;
  merges: Record<string, MergeEntry>;
  /** Per-task timestamp of last message read, written by `fleet prime`. */
  lastCheck: Record<string, string>;
}

const TaskStateSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'in_review', 'done']),
  claimed: z.string().optional(),
  doneAt: z.string().optional(),
  focus: z.array(z.string()).optional(),
  reviewCycle: z.number().optional().default(0),
  verdict: z.enum(['pass', 'fail', 'skip']).optional(),
});

const MergeEntrySchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['pending', 'skipped']) }),
  z.object({ status: z.literal('merged'), merged: z.string() }),
  z.object({ status: z.literal('conflict'), brief: z.string() }),
]);

const SyncStateSchema = z.object({
  session: z.string(),
  config: z.string(),
  target: z.string(),
  tasks: z.record(z.string(), TaskStateSchema),
  merges: z.record(z.string(), MergeEntrySchema).default({}),
  lastCheck: z.record(z.string(), z.string()).default({}),
});

function syncBranchExists(repoRoot?: string): boolean {
  try {
    git(['rev-parse', '--verify', SYNC_BRANCH], { cwd: repoRoot, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree at .fleet/sync/ for the fleet-sync branch.
 * If no branch exists, creates an orphan worktree.
 * Idempotent: returns immediately if the worktree already exists.
 */
export function initSyncWorktree(repoRoot: string): string {
  const worktreePath = resolve(repoRoot, '.fleet', 'sync');

  if (existsSync(join(worktreePath, '.git'))) {
    return worktreePath;
  }

  rmSync(worktreePath, { recursive: true, force: true });

  if (syncBranchExists(repoRoot)) {
    git(['worktree', 'add', worktreePath, SYNC_BRANCH], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } else {
    git(['worktree', 'add', '--orphan', '-b', SYNC_BRANCH, worktreePath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }

  return worktreePath;
}

/**
 * Resolve the absolute path to .fleet/sync/ from any worktree.
 * Agents run in task worktrees (-fleet-auth, -fleet-api) but the sync
 * worktree lives in the main repo. This uses git-common-dir to find
 * the shared .git path and derives the main worktree from it.
 *
 * Memoized per-process — safe because fleet runs as a short-lived CLI.
 */
const syncDirCache = new Map<string, string>();

export function resolveSyncDir(repoRoot: string): string {
  const cached = syncDirCache.get(repoRoot);
  if (cached) return cached;

  const gitCommonDir = git(['rev-parse', '--git-common-dir'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const mainRoot = resolve(repoRoot, gitCommonDir, '..');
  const result = resolve(mainRoot, '.fleet', 'sync');
  syncDirCache.set(repoRoot, result);
  return result;
}

/**
 * Remove the sync worktree at .fleet/sync/.
 * Idempotent: no error if no worktree exists.
 */
export function removeSyncWorktree(repoRoot: string): void {
  const worktreePath = resolve(repoRoot, '.fleet', 'sync');

  try {
    git(['worktree', 'remove', '--force', worktreePath], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    git(['worktree', 'prune'], { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    // Prune failure is non-critical — stale refs get cleaned next session
  }
}

/**
 * Stage all changes in the sync worktree and commit with retry.
 * Retries on index.lock contention (concurrent multi-agent writes).
 */
function commitSyncChanges(syncDir: string, message: string): void {
  const errors: string[] = [];
  let lastCause: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      git(['add', '-A'], { cwd: syncDir, stdio: 'pipe' });
      git(['commit', '--allow-empty', '-m', message], {
        cwd: syncDir,
        stdio: 'pipe',
      });
      return;
    } catch (err) {
      lastCause = err instanceof Error ? err : new CLIError(String(err));
      errors.push(`attempt ${attempt}: ${toErrorMessage(err)}`);
      if (attempt === MAX_RETRIES) {
        throw new ExternalCommandError(
          `Failed to commit sync changes after ${MAX_RETRIES} attempts:\n${errors.join('\n')}`,
          { cause: lastCause },
        );
      }
    }
  }
}

/** Read and parse the sync state from the sync worktree, or null if unavailable. */
export function readSyncState(repoRoot?: string): SyncState | null {
  try {
    const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
    const raw = readFileSync(resolve(syncDir, STATE_FILE), 'utf-8');
    return SyncStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Read a file from the sync worktree by relative path, or null if missing. */
export function readSyncFile(path: string, repoRoot?: string): string | null {
  try {
    const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
    return readFileSync(resolve(syncDir, path), 'utf-8');
  } catch {
    return null;
  }
}

/** List files under a directory prefix in the sync worktree. */
export function listSyncDir(prefix: string, repoRoot?: string): string[] {
  try {
    const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
    const dir = resolve(syncDir, prefix);
    const entries = readdirSync(dir);
    return entries.map((e) => `${prefix}/${e}`);
  } catch {
    return [];
  }
}

/** Write sync state to the sync worktree and commit. */
export function writeSyncState(state: SyncState, repoRoot?: string): void {
  const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
  writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  commitSyncChanges(syncDir, 'fleet: update sync state');
}

/** Write sync state and additional files in one atomic commit. */
export function writeSyncStateAndFiles(
  state: SyncState,
  files: Array<{ path: string; content: string }>,
  repoRoot?: string,
): void {
  const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
  writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  for (const file of files) {
    const filePath = resolve(syncDir, file.path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
  }
  commitSyncChanges(syncDir, 'fleet: update sync state');
}

/** Write a single file to the sync worktree and commit. */
export function writeSyncFile(path: string, content: string, repoRoot?: string): void {
  const syncDir = resolveSyncDir(repoRoot ?? process.cwd());
  const filePath = resolve(syncDir, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  commitSyncChanges(syncDir, `fleet: update ${path}`);
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
    tasks[name] = { status: 'pending', reviewCycle: 0, ...(focus ? { focus } : {}) };
  }

  return {
    session: new Date().toISOString(),
    config: configPath,
    target,
    tasks,
    merges: {},
    lastCheck: {},
  };
}

/** Transition a task to `in_progress` with a claimed timestamp. */
export function claimTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new NotFoundError(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: 'in_progress',
        claimed: new Date().toISOString(),
        reviewCycle: task.reviewCycle ?? 0,
      },
    },
  };
}

/**
 * Atomically claim a task with fresh-read retry. Avoids the stale-read race
 * where concurrent agents overwrite each other's claims.
 * Each retry re-reads state.json so it sees other agents' writes.
 */
export function claimTaskAtomic(taskName: string, repoRoot: string): void {
  const syncDir = resolveSyncDir(repoRoot);
  const filePath = resolve(syncDir, STATE_FILE);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const raw = readFileSync(filePath, 'utf-8');
    const state = SyncStateSchema.parse(JSON.parse(raw));
    const task = state.tasks[taskName];
    if (!task || task.status !== 'pending') return;

    state.tasks[taskName] = {
      ...task,
      status: 'in_progress',
      claimed: new Date().toISOString(),
    };

    writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
    try {
      git(['add', '-A'], { cwd: syncDir, stdio: 'pipe' });
      git(['commit', '-m', `fleet: claim ${taskName}`], { cwd: syncDir, stdio: 'pipe' });
      return;
    } catch {
      const delayMs = 50 * attempt + Math.random() * 100;
      const end = Date.now() + delayMs;
      while (Date.now() < end) {
        /* spin — acceptable for short CLI retry backoff */
      }
    }
  }
}

/**
 * Atomically update the lastCheck cursor for a task. Same fresh-read pattern
 * as claimTaskAtomic to avoid clobbering concurrent writes.
 */
export function updateLastCheck(taskName: string, repoRoot: string): void {
  const syncDir = resolveSyncDir(repoRoot);
  const filePath = resolve(syncDir, STATE_FILE);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const raw = readFileSync(filePath, 'utf-8');
    const state = SyncStateSchema.parse(JSON.parse(raw));

    state.lastCheck = { ...state.lastCheck, [taskName]: new Date().toISOString() };

    writeFileSync(resolve(syncDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
    try {
      git(['add', '-A'], { cwd: syncDir, stdio: 'pipe' });
      git(['commit', '-m', `fleet: update lastCheck ${taskName}`], { cwd: syncDir, stdio: 'pipe' });
      return;
    } catch {
      const delayMs = 50 * attempt + Math.random() * 100;
      const end = Date.now() + delayMs;
      while (Date.now() < end) {
        /* spin */
      }
    }
  }
}

/** Transition a task to `in_review` and increment its review cycle counter. */
export function submitForReview(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new NotFoundError(`Task not found in sync state: ${taskName}`);

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
  if (!task) throw new NotFoundError(`Task not found in sync state: ${taskName}`);

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
  if (!task) throw new NotFoundError(`Task not found in sync state: ${taskName}`);

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
 * Archive the sync worktree contents to .fleet/sessions/<date>-<target>/.
 * Copies state.json, inbox/, conflicts/, and fleet.yaml.
 * Returns the archive path, or null if nothing to archive.
 */
export function archiveSession(repoRoot: string, target: string): string | null {
  const syncDir = resolve(repoRoot, '.fleet', 'sync');
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
  const archiveDir = resolve(repoRoot, '.fleet', 'sessions', `${datePrefix}-${sanitized}`);
  mkdirSync(archiveDir, { recursive: true });

  copyFileSync(stateFile, resolve(archiveDir, 'state.json'));

  for (const dir of ['inbox', 'review', 'conflicts', 'specs']) {
    const src = resolve(syncDir, dir);
    if (existsSync(src)) {
      cpSync(src, resolve(archiveDir, dir), { recursive: true });
    }
  }

  const configPath = resolve(repoRoot, '.fleet', 'fleet.yaml');
  if (existsSync(configPath)) {
    copyFileSync(configPath, resolve(archiveDir, 'fleet.yaml'));
  }

  return archiveDir;
}

/** Read sync state and assert it exists (exits with error if missing). */
export function readRequiredSyncState(repoRoot: string): SyncState {
  const state = readSyncState(repoRoot);
  requireSyncState(state);
  return state;
}

/** Sanitize a branch name and return the review file path on the sync branch. */
export function reviewFilePath(branch: string): string {
  const safeBranch = sanitizeBranchName(branch);
  return `review/${safeBranch}.md`;
}

/** Detect the task name from the worktree or throw if not in a worktree. */
export function requireWorktreeTask(repoRoot: string): string {
  const taskName = detectTaskName(repoRoot);
  if (!taskName) {
    throw new CLIError(
      'Not in a fleet worktree. This command must be run from a task worktree (with .fleet/tasks/<name>.md).',
    );
  }
  return taskName;
}
