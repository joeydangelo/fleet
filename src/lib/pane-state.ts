import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PawPaneConfig, PawPane, TmuxServiceApi } from './tmux.js';

const PANES_FILE = 'panes.json';

function panesPath(repoRoot: string): string {
  return resolve(repoRoot, '.paw', PANES_FILE);
}

/**
 * Atomic file write: write to temp file, then rename. Prevents
 * corruption if the process crashes mid-write.
 */
function atomicWriteSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempSuffix = randomBytes(8).toString('hex');
  const tempPath = resolve(dir, `.${basename(filePath)}.${tempSuffix}.tmp`);

  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Cleanup failure is non-critical
    }
    throw error;
  }
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
  atomicWriteSync(p, JSON.stringify(config, null, 2) + '\n');
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

/**
 * Restore panes from persisted config. Checks which tmux panes still
 * exist and recreates missing ones.
 */
export function restorePanes(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
): PawPane[] {
  const config = readPaneConfig(repoRoot);
  if (!config || config.panes.length === 0) return [];

  const existingPanes = tmux.listPanes(sessionName);
  const restored: PawPane[] = [];

  for (const pane of config.panes) {
    if (existingPanes.includes(pane.paneId)) {
      restored.push(pane);
      continue;
    }

    if (existsSync(pane.worktreePath)) {
      const newPaneId = tmux.createPane(sessionName, pane.worktreePath);
      tmux.setPaneTitle(newPaneId, `paw-${pane.taskName}`);

      tmux.sendKeys(newPaneId, `echo "Restored pane: ${pane.taskName} (${pane.agent})"`);
      tmux.sendKeys(newPaneId, `echo "Original prompt: ${pane.prompt}"`);

      restored.push({ ...pane, paneId: newPaneId });
    }
  }

  // Update persisted state with new pane IDs
  if (restored.length > 0) {
    savePanes(repoRoot, sessionName, restored);
  }

  return restored;
}
