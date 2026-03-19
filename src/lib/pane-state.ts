import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { writeFileSync } from 'atomically';
import { z } from 'zod';
import type { TmuxServiceApi } from './tmux.js';
import { tmuxSessionName } from './tmux.js';

const PANES_FILE = 'panes.json';

export const DetachedAgentSchema = z.object({
  id: z.string(),
  sessionName: z.string(),
  taskName: z.string(),
  worktreePath: z.string(),
  branchName: z.string(),
});

export const FleetPaneConfigSchema = z.object({
  mode: z.literal('detached'),
  sessionName: z.string(),
  repoRoot: z.string(),
  detached: z.array(DetachedAgentSchema),
  lastUpdated: z.string(),
});

export type DetachedAgent = z.infer<typeof DetachedAgentSchema>;
export type FleetPaneConfig = z.infer<typeof FleetPaneConfigSchema>;

function panesPath(repoRoot: string): string {
  return resolve(repoRoot, '.fleet', 'run', PANES_FILE);
}

/** Read persisted pane config. Returns null if file is missing or corrupt. */
export function readPaneConfig(repoRoot: string): FleetPaneConfig | null {
  const p = panesPath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    const result = FleetPaneConfigSchema.safeParse(JSON.parse(readFileSync(p, 'utf-8')));
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

/** Persist pane config to .fleet/run/panes.json using atomic writes. */
export function writePaneConfig(repoRoot: string, config: FleetPaneConfig): void {
  const p = panesPath(repoRoot);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

/** Persist detached-mode agent sessions for monitoring and teardown. */
export function saveDetachedAgents(
  repoRoot: string,
  sessionName: string,
  agents: DetachedAgent[],
): void {
  const config: FleetPaneConfig = {
    mode: 'detached',
    sessionName,
    repoRoot,
    detached: agents,
    lastUpdated: new Date().toISOString(),
  };
  writePaneConfig(repoRoot, config);
}

/** Resolve the tmux target (session name) for a task by name. */
export function resolvePaneTarget(paneConfig: FleetPaneConfig, taskName: string): string | null {
  const agent = paneConfig.detached.find((a) => a.taskName === taskName);
  return agent?.sessionName ?? null;
}

/** Kill all detached agent sessions recorded in panes.json. */
export function killDetachedAgents(tmux: TmuxServiceApi, repoRoot: string): void {
  const config = readPaneConfig(repoRoot);
  if (!config) return;

  for (const agent of config.detached) {
    if (tmux.sessionExists(agent.sessionName)) {
      tmux.killSession(agent.sessionName);
    }
  }

  writePaneConfig(repoRoot, {
    ...config,
    detached: [],
    lastUpdated: new Date().toISOString(),
  });
}

/**
 * Kill tmux sessions matching this repo's prefix that aren't tracked in panes.json.
 * Catches orphans left behind when fleet.yaml tasks change between runs.
 */
export function killOrphanedAgentSessions(tmux: TmuxServiceApi, repoRoot: string): void {
  const prefix = tmuxSessionName(basename(repoRoot));
  const agentPrefix = `${prefix}-`;

  const allSessions = tmux.listSessions();
  if (allSessions.length === 0) return;

  const config = readPaneConfig(repoRoot);
  const tracked = new Set<string>();
  if (config) {
    for (const agent of config.detached) {
      tracked.add(agent.sessionName);
    }
  }

  for (const name of allSessions) {
    if (name.startsWith(agentPrefix) && !tracked.has(name)) {
      tmux.killSession(name);
    }
  }
}
