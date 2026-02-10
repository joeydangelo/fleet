import { resolve } from "node:path";
import { git } from "./git.js";

const SYNC_BRANCH = "paw-sync";
const STATE_FILE = "state.json";
const MAX_RETRIES = 3;

export interface TaskState {
  status: "pending" | "in_progress" | "completed";
  claimed?: string;
  completed?: string;
}

export type MergeStatus = "pending" | "merged" | "skipped" | "conflict";

export interface MergeEntry {
  status: MergeStatus;
  /** ISO timestamp when merged clean. */
  merged?: string;
  /** Path to conflict brief on sync branch. */
  brief?: string;
}

export interface SyncState {
  session: string;
  config: string;
  target: string;
  tasks: Record<string, TaskState>;
  merges?: Record<string, MergeEntry>;
  /** Per-task timestamp of last `paw check` run. */
  lastCheck?: Record<string, string>;
}

function syncBranchExists(cwd?: string): boolean {
  try {
    git(["rev-parse", "--verify", SYNC_BRANCH], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function readSyncState(cwd?: string): SyncState | null {
  if (!syncBranchExists(cwd)) return null;

  try {
    const raw = git(["show", `${SYNC_BRANCH}:${STATE_FILE}`], {
      cwd,
      stdio: "pipe",
    });
    return JSON.parse(raw) as SyncState;
  } catch {
    return null;
  }
}

/** Run a function with GIT_INDEX_FILE pointed at the paw-sync isolated index. */
function withSyncIndex<T>(fn: () => T, cwd?: string): T {
  const gitDir = git(["rev-parse", "--git-dir"], { cwd });
  const effectiveCwd = cwd || process.cwd();
  const indexFile = resolve(effectiveCwd, gitDir, "paw-index");
  const originalIndex = process.env.GIT_INDEX_FILE;

  try {
    process.env.GIT_INDEX_FILE = indexFile;
    return fn();
  } finally {
    if (originalIndex) {
      process.env.GIT_INDEX_FILE = originalIndex;
    } else {
      delete process.env.GIT_INDEX_FILE;
    }
  }
}

/**
 * Write one or more files to the paw-sync branch in a single atomic commit.
 * Uses an isolated git index to avoid touching the working tree.
 */
function writeSyncFilesRetry(
  files: Array<{ path: string; content: string }>,
  message: string,
  cwd?: string,
): void {
  const pipeOpts = { cwd, stdio: "pipe" as const };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (syncBranchExists(cwd)) {
        git(["read-tree", SYNC_BRANCH], pipeOpts);
      }

      for (const file of files) {
        const blob = git(["hash-object", "-w", "--stdin"], {
          ...pipeOpts,
          input: file.content,
        });
        git(
          [
            "update-index",
            "--add",
            "--cacheinfo",
            `100644,${blob},${file.path}`,
          ],
          pipeOpts,
        );
      }

      const tree = git(["write-tree"], pipeOpts);
      const commitArgs = ["commit-tree", tree, "-m", message];
      if (syncBranchExists(cwd)) {
        const parent = git(["rev-parse", SYNC_BRANCH], pipeOpts);
        commitArgs.push("-p", parent);
      }

      const commit = git(commitArgs, pipeOpts);
      git(["update-ref", `refs/heads/${SYNC_BRANCH}`, commit], pipeOpts);
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed to write to sync branch after ${MAX_RETRIES} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

/**
 * Write sync state to the paw-sync branch using an isolated git index.
 * Pattern from tbd: set GIT_INDEX_FILE to avoid touching the working tree's
 * index, then use read-tree/hash-object/write-tree/commit-tree/update-ref
 * to commit directly to the orphan branch.
 */
export function writeSyncState(state: SyncState, cwd?: string): void {
  withSyncIndex(
    () =>
      writeSyncFilesRetry(
        [{ path: STATE_FILE, content: JSON.stringify(state, null, 2) + "\n" }],
        "paw: update sync state",
        cwd,
      ),
    cwd,
  );
}

/** Write sync state and additional files in one atomic commit. */
export function writeSyncStateAndFiles(
  state: SyncState,
  files: Array<{ path: string; content: string }>,
  cwd?: string,
): void {
  withSyncIndex(
    () =>
      writeSyncFilesRetry(
        [
          {
            path: STATE_FILE,
            content: JSON.stringify(state, null, 2) + "\n",
          },
          ...files,
        ],
        "paw: update sync state",
        cwd,
      ),
    cwd,
  );
}

/** Write a single file to the sync branch. */
export function writeSyncFile(
  path: string,
  content: string,
  cwd?: string,
): void {
  withSyncIndex(
    () => writeSyncFilesRetry([{ path, content }], `paw: update ${path}`, cwd),
    cwd,
  );
}

/** Read a file from the sync branch. Returns null if not found. */
export function readSyncFile(path: string, cwd?: string): string | null {
  if (!syncBranchExists(cwd)) return null;
  try {
    return git(["show", `${SYNC_BRANCH}:${path}`], { cwd, stdio: "pipe" });
  } catch {
    return null;
  }
}

/** List files under a directory prefix on the sync branch. */
export function listSyncDir(prefix: string, cwd?: string): string[] {
  if (!syncBranchExists(cwd)) return [];
  try {
    const output = git(["ls-tree", "--name-only", SYNC_BRANCH, prefix + "/"], {
      cwd,
      stdio: "pipe",
    });
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function initSyncState(
  target: string,
  taskNames: string[],
  configPath: string,
): SyncState {
  const tasks: Record<string, TaskState> = {};
  for (const name of taskNames) {
    tasks[name] = { status: "pending" };
  }

  return {
    session: new Date().toISOString(),
    config: configPath,
    target,
    tasks,
  };
}

export function claimTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: "in_progress",
        claimed: new Date().toISOString(),
      },
    },
  };
}

export function completeTask(state: SyncState, taskName: string): SyncState {
  const task = state.tasks[taskName];
  if (!task) throw new Error(`Task not found in sync state: ${taskName}`);

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...task,
        status: "completed",
        completed: new Date().toISOString(),
      },
    },
  };
}

/** Create initial merge state with all tasks pending. */
export function initMergeState(
  taskNames: string[],
): Record<string, MergeEntry> {
  const merges: Record<string, MergeEntry> = {};
  for (const name of taskNames) {
    merges[name] = { status: "pending" };
  }
  return merges;
}

/** Return a new SyncState with one merge entry updated. */
export function updateMergeEntry(
  state: SyncState,
  taskName: string,
  entry: MergeEntry,
): SyncState {
  return {
    ...state,
    merges: {
      ...state.merges,
      [taskName]: entry,
    },
  };
}
