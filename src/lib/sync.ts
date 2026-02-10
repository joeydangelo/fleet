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

export interface SyncState {
  session: string;
  config: string;
  target: string;
  tasks: Record<string, TaskState>;
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
    const raw = git(
      ["show", `${SYNC_BRANCH}:${STATE_FILE}`],
      { cwd, stdio: "pipe" },
    );
    return JSON.parse(raw) as SyncState;
  } catch {
    return null;
  }
}

/**
 * Write sync state to the paw-sync branch using an isolated git index.
 * Pattern from tbd: set GIT_INDEX_FILE to avoid touching the working tree's
 * index, then use read-tree/hash-object/write-tree/commit-tree/update-ref
 * to commit directly to the orphan branch.
 */
export function writeSyncState(state: SyncState, cwd?: string): void {
  const gitDir = git(["rev-parse", "--git-dir"], { cwd });
  const indexFile = resolve(gitDir, "paw-index");
  const originalIndex = process.env.GIT_INDEX_FILE;

  try {
    process.env.GIT_INDEX_FILE = indexFile;
    writeSyncStateWithRetry(state, cwd);
  } finally {
    if (originalIndex) {
      process.env.GIT_INDEX_FILE = originalIndex;
    } else {
      delete process.env.GIT_INDEX_FILE;
    }
  }
}

function writeSyncStateWithRetry(state: SyncState, cwd?: string): void {
  const pipeOpts = { cwd, stdio: "pipe" as const };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Read existing tree into isolated index if branch exists
      if (syncBranchExists(cwd)) {
        git(["read-tree", SYNC_BRANCH], pipeOpts);
      }

      // Write state.json as a blob via stdin
      const content = JSON.stringify(state, null, 2) + "\n";
      const blob = git(
        ["hash-object", "-w", "--stdin"],
        { ...pipeOpts, input: content },
      );

      // Add blob to index
      git(
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${STATE_FILE}`],
        pipeOpts,
      );

      // Write tree, create commit, update branch ref
      const tree = git(["write-tree"], pipeOpts);

      const commitArgs = ["commit-tree", tree, "-m", "paw: update sync state"];
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
          `Failed to write sync state after ${MAX_RETRIES} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
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
