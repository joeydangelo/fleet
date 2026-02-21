import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeFileSync } from 'atomically';
import type { PawPaneConfig, PawPane, TmuxServiceApi } from './tmux.js';

const PANES_FILE = 'panes.json';

function panesPath(repoRoot: string): string {
  return resolve(repoRoot, '.paw', PANES_FILE);
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

/** Save panes after creation or update. */
export function savePanes(repoRoot: string, sessionName: string, panes: PawPane[]): void {
  const config: PawPaneConfig = {
    sessionName,
    projectRoot: repoRoot,
    panes,
    lastUpdated: new Date().toISOString(),
  };
  writePaneConfig(repoRoot, config);
}

/** Kill all persisted agent panes and remove panes.json. */
export function killPanes(tmux: TmuxServiceApi, repoRoot: string): void {
  const config = readPaneConfig(repoRoot);
  if (!config || config.panes.length === 0) return;

  for (const pane of config.panes) {
    if (tmux.paneExists(pane.paneId)) {
      tmux.killPane(pane.paneId);
    }
  }

  const p = panesPath(repoRoot);
  try {
    unlinkSync(p);
  } catch {
    // already removed
  }
}

/**
 * Restore panes from persisted config. For each persisted pane:
 * 1. If the pane ID still exists in tmux, keep it
 * 2. If the pane ID is gone, try title-based rebinding (match paw-{taskName})
 * 3. If no title match and worktree still exists, recreate the pane
 */
export function restorePanes(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
): PawPane[] {
  const config = readPaneConfig(repoRoot);
  if (!config || config.panes.length === 0) return [];

  const existingPanes = tmux.listPanes(sessionName);
  const titleMap = tmux.listPanesWithTitles(sessionName);
  const restored: PawPane[] = [];

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

    if (existsSync(pane.worktreePath)) {
      const newPaneId = tmux.createPane(sessionName, pane.worktreePath);
      tmux.setPaneTitle(newPaneId, expectedTitle);

      tmux.sendKeys(newPaneId, `echo "Restored pane: ${pane.taskName} (${pane.agent})"`);
      tmux.sendKeys(newPaneId, `echo "Original prompt: ${pane.prompt}"`);

      restored.push({ ...pane, paneId: newPaneId });
    }
  }

  if (restored.length > 0) {
    savePanes(repoRoot, sessionName, restored);
  }

  return restored;
}
