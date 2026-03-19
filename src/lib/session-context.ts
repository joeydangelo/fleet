import { loadRepoConfig } from './config.js';
import type { FleetConfig } from './config.js';
import { getRepoRoot } from './git.js';
import { planWorktrees, getTaskIdentity } from './session.js';
import type { WorktreeInfo } from './session.js';
import { readSyncState, readRequiredSyncState } from './sync.js';
import type { SyncState } from './sync.js';

export interface SessionContext {
  repoRoot: string;
  configPath: string;
  config: FleetConfig;
  worktrees: WorktreeInfo[];
  syncState: SyncState | null;
}

/** Load the full session context in one call (repo config + worktrees + sync state). */
export function loadSessionContext(): SessionContext {
  const { repoRoot, configPath, config } = loadRepoConfig();
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);
  return { repoRoot, configPath, config, worktrees, syncState };
}

export interface FleetSession {
  repoRoot: string;
  taskName: string;
  syncState: SyncState;
}

/** Assert we're in a fleet session and return the repo root, task identity, and sync state. */
export function requireFleetSession(): FleetSession {
  const repoRoot = getRepoRoot();
  const taskName = getTaskIdentity(repoRoot);
  const syncState = readRequiredSyncState(repoRoot);
  return { repoRoot, taskName, syncState };
}
