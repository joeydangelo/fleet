import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeFileSync } from 'atomically';
import type { PawPaneConfig, PawPane, DetachedAgent, TmuxServiceApi } from './tmux.js';
import { ORCHESTRATOR_ROLE } from './constants.js';

const PANES_FILE = 'panes.json';

/** Tag a pane with the orchestrator role so it can be identified on restore. */
export function labelOrchestrator(tmux: TmuxServiceApi, paneId: string): void {
  tmux.setPaneTitle(paneId, ORCHESTRATOR_ROLE);
  tmux.setPaneRole(paneId, ORCHESTRATOR_ROLE);
}

function panesPath(repoRoot: string): string {
  return resolve(repoRoot, '.paw', 'run', PANES_FILE);
}

/** Read persisted pane config. Returns null if file is missing or corrupt. */
export function readPaneConfig(repoRoot: string): PawPaneConfig | null {
  const p = panesPath(repoRoot);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PawPaneConfig;
  } catch {
    return null;
  }
}

/** Persist pane config to .paw/panes.json using atomic writes. */
export function writePaneConfig(repoRoot: string, config: PawPaneConfig): void {
  const p = panesPath(repoRoot);
  const dir = dirname(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

/** Persist the current pane layout for later restore or TUI re-attach. */
export function savePanes(
  repoRoot: string,
  sessionName: string,
  panes: PawPane[],
  orchestratorPaneId: string,
): void {
  const config: PawPaneConfig = {
    sessionName,
    projectRoot: repoRoot,
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
  const config: PawPaneConfig = {
    mode: 'detached',
    sessionName,
    projectRoot: repoRoot,
    orchestratorPaneId: '',
    panes: [],
    detached: agents,
    lastUpdated: new Date().toISOString(),
  };
  writePaneConfig(repoRoot, config);
}

/** Resolve the tmux target (session name or pane ID) for a task by name. */
export function resolvePaneTarget(paneConfig: PawPaneConfig, taskName: string): string | null {
  if (paneConfig.mode === 'detached' && paneConfig.detached) {
    const agent = paneConfig.detached.find((a) => a.taskName === taskName);
    return agent?.sessionName ?? null;
  }
  const pane = paneConfig.panes.find((p) => p.taskName === taskName);
  return pane?.paneId ?? null;
}

/**
 * Kill all persisted task panes, then clear the panes array in panes.json.
 * Preserves orchestratorPaneId so the next `paw` run finds the surviving
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
  writePaneConfig(repoRoot, { ...config, panes: [], lastUpdated: new Date().toISOString() });
}

/** Kill all detached agent sessions recorded in panes.json. */
export function killDetachedAgents(tmux: TmuxServiceApi, repoRoot: string): void {
  const config = readPaneConfig(repoRoot);
  if (!config?.detached) return;

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
 * Restore panes from persisted config. Each task pane is resolved through a
 * fallback chain: keep existing pane → title-based rebinding → recreate from
 * worktree. Also restores the orchestrator pane if it was tracked but is gone.
 */
export function restorePanes(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
): { panes: PawPane[]; orchestratorPaneId: string } {
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
  const restored: PawPane[] = [];

  if (config.panes.length > 0) {
    const titleMap = tmux.listPanesWithTitles(sessionName);

    for (const pane of config.panes) {
      if (existingPanes.includes(pane.paneId)) {
        restored.push(pane);
        continue;
      }

      const expectedTitle = `paw-${pane.taskName}`;
      const reboundId = titleMap.get(expectedTitle);
      if (reboundId) {
        restored.push({ ...pane, paneId: reboundId });
        continue;
      }

      /** An empty shell here would block `paw launch` from detecting the missing agent. */
    }
  }

  /** Use `paneExists` rather than `listPanes` to avoid timing races on cold start. */
  let orchestratorPaneId = config.orchestratorPaneId;
  if (orchestratorPaneId && !tmux.paneExists(orchestratorPaneId)) {
    orchestratorPaneId = tmux.createPane(sessionName, config.projectRoot, { horizontal: true });
    labelOrchestrator(tmux, orchestratorPaneId);
    tmux.setPaneProject(orchestratorPaneId, config.projectRoot);
  }

  if (restored.length > 0 || orchestratorPaneId !== config.orchestratorPaneId) {
    savePanes(repoRoot, sessionName, restored, orchestratorPaneId);
  }

  return { panes: restored, orchestratorPaneId };
}
