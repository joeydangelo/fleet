import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { writeFileSync } from 'atomically';
import { z } from 'zod';
import type { FleetPaneConfig, FleetPane, DetachedAgent, TmuxServiceApi } from './tmux.js';
import { tmuxSessionName } from './tmux.js';
import { ORCHESTRATOR_ROLE } from './constants.js';

const PANES_FILE = 'panes.json';

const FleetPaneSchema = z.object({
  id: z.string(),
  paneId: z.string(),
  taskName: z.string(),
  worktreePath: z.string(),
  branchName: z.string(),
});

const DetachedAgentSchema = z.object({
  id: z.string(),
  sessionName: z.string(),
  taskName: z.string(),
  worktreePath: z.string(),
  branchName: z.string(),
});

const FleetPaneConfigBaseSchema = z.object({
  sessionName: z.string(),
  repoRoot: z.string(),
  orchestratorPaneId: z.string(),
  panes: z.array(FleetPaneSchema),
  lastUpdated: z.string(),
});

export const FleetPaneConfigSchema = z.union([
  FleetPaneConfigBaseSchema.extend({
    mode: z.literal('detached'),
    detached: z.array(DetachedAgentSchema),
  }),
  FleetPaneConfigBaseSchema.extend({ mode: z.literal('attached') }),
  FleetPaneConfigBaseSchema,
]);

/** Tag a pane with the orchestrator role so it can be identified on restore. */
export function labelOrchestrator(tmux: TmuxServiceApi, paneId: string): void {
  tmux.setPaneTitle(paneId, ORCHESTRATOR_ROLE);
  tmux.setPaneRole(paneId, ORCHESTRATOR_ROLE);
}

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
    return result.data as FleetPaneConfig;
  } catch {
    return null;
  }
}

/** Persist pane config to .fleet/panes.json using atomic writes. */
export function writePaneConfig(repoRoot: string, config: FleetPaneConfig): void {
  const p = panesPath(repoRoot);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

/** Persist the current pane layout for later restore or TUI re-attach. */
export function savePanes(
  repoRoot: string,
  sessionName: string,
  panes: FleetPane[],
  orchestratorPaneId: string,
): void {
  const config: FleetPaneConfig = {
    mode: 'attached',
    sessionName,
    repoRoot,
    orchestratorPaneId,
    panes,
    lastUpdated: new Date().toISOString(),
  };
  writePaneConfig(repoRoot, config);
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
    orchestratorPaneId: '',
    panes: [],
    detached: agents,
    lastUpdated: new Date().toISOString(),
  };
  writePaneConfig(repoRoot, config);
}

/** Resolve the tmux target (session name or pane ID) for a task by name. */
export function resolvePaneTarget(paneConfig: FleetPaneConfig, taskName: string): string | null {
  if (paneConfig.mode === 'detached') {
    const agent = paneConfig.detached.find((a) => a.taskName === taskName);
    return agent?.sessionName ?? null;
  }
  const pane = paneConfig.panes.find((p) => p.taskName === taskName);
  return pane?.paneId ?? null;
}

/**
 * Kill all persisted task panes, then clear the panes array in panes.json.
 * Preserves orchestratorPaneId so the next `fleet tui` run finds the surviving
 * orchestrator without creating a duplicate. Skips panes that no longer exist.
 */
export function killPanes(tmux: TmuxServiceApi, repoRoot: string): void {
  const config = readPaneConfig(repoRoot);
  if (!config) return;

  for (const pane of config.panes) {
    if (tmux.paneExists(pane.paneId)) {
      tmux.killPane(pane.paneId);
    }
  }

  /** Preserve `orchestratorPaneId` so re-entry doesn't spawn a duplicate. */
  writePaneConfig(repoRoot, {
    ...config,
    panes: [],
    lastUpdated: new Date().toISOString(),
  } as FleetPaneConfig);
}

/** Kill all detached agent sessions recorded in panes.json. */
export function killDetachedAgents(tmux: TmuxServiceApi, repoRoot: string): void {
  const config = readPaneConfig(repoRoot);
  if (!config || config.mode !== 'detached') return;

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
  if (config?.mode === 'detached') {
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

/**
 * Restore panes from persisted config. Each task pane is resolved through a
 * fallback chain: keep existing pane → title-based rebinding → recreate from
 * worktree. Also restores the orchestrator pane if it was tracked but is gone.
 */
export function restorePanes(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
): { panes: FleetPane[]; orchestratorPaneId: string } {
  const config = readPaneConfig(repoRoot);
  if (!config) {
    // No panes.json — check for a surviving orchestrator pane by title.
    // This handles cases where panes.json was manually deleted or lost (e.g.
    // WSL restart) while the tmux session was still running.
    const titleMap = tmux.listPanesWithTitles(sessionName);
    const orchestratorPaneId = titleMap.get(ORCHESTRATOR_ROLE) ?? '';
    if (orchestratorPaneId) {
      savePanes(repoRoot, sessionName, [], orchestratorPaneId);
    }
    return { panes: [], orchestratorPaneId };
  }

  const existingPanes = tmux.listPanes(sessionName);
  const restored: FleetPane[] = [];

  if (config.panes.length > 0) {
    const titleMap = tmux.listPanesWithTitles(sessionName);

    for (const pane of config.panes) {
      if (existingPanes.includes(pane.paneId)) {
        restored.push(pane);
        continue;
      }

      const expectedTitle = `fleet-${pane.taskName}`;
      const reboundId = titleMap.get(expectedTitle);
      if (reboundId) {
        restored.push({ ...pane, paneId: reboundId });
        continue;
      }

      /** An empty shell here would block `fleet launch` from detecting the missing agent. */
    }
  }

  /** Use `paneExists` rather than `listPanes` to avoid timing races on cold start. */
  let orchestratorPaneId = config.orchestratorPaneId;
  if (orchestratorPaneId && !tmux.paneExists(orchestratorPaneId)) {
    orchestratorPaneId = tmux.createPane(sessionName, config.repoRoot, { horizontal: true });
    labelOrchestrator(tmux, orchestratorPaneId);
    tmux.setPaneProject(orchestratorPaneId, config.repoRoot);
  }

  if (restored.length > 0 || orchestratorPaneId !== config.orchestratorPaneId) {
    savePanes(repoRoot, sessionName, restored, orchestratorPaneId);
  }

  return { panes: restored, orchestratorPaneId };
}
