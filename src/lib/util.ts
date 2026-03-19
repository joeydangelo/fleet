import { existsSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { join, resolve } from 'node:path';
import { readDoc } from './docs.js';
import { readPaneConfig } from './pane-state.js';
import { createTmuxService, checkAgentLiveness, buildLivenessMap } from './tmux.js';
import type { FleetPaneConfig } from './tmux.js';

/**
 * Try to build a liveness map from tmux pane config.
 * Accepts either a repoRoot string (reads pane config internally) or
 * a pre-read FleetPaneConfig. Returns an empty map if config is null or tmux is unavailable.
 */
export function tryGetLivenessMap(
  repoRootOrConfig: string | FleetPaneConfig | null,
): Map<string, boolean> {
  const paneConfig =
    typeof repoRootOrConfig === 'string' ? readPaneConfig(repoRootOrConfig) : repoRootOrConfig;
  if (!paneConfig) return new Map();
  try {
    const tmux = createTmuxService();
    const results = checkAgentLiveness(tmux, paneConfig);
    return buildLivenessMap(results);
  } catch {
    return new Map();
  }
}

/** Swallow ENOENT errors, returning null; rethrow everything else. */
export function returnNullOnENOENT<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Run a void function, silently swallowing ENOENT errors; rethrow everything else. */
export function swallowENOENT(fn: () => void): void {
  try {
    fn();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

/** Sanitize a string for use as a branch name component by replacing non-alphanumeric chars with hyphens. */
export function sanitizeBranchName(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Return a promise that resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format elapsed milliseconds as "Xm Ys". */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Walk `__dirname`-relative candidates to find a bundled directory.
 * Returns the first existing path, or null if none found.
 */
export function findBundledDir(base: string, name: string): string | null {
  const candidates = [join(base, name), join(base, '..', 'src', name), join(base, '..', name)];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read the fleet-yaml template doc, extract the YAML block, and write .fleet/fleet.yaml.
 * Returns true on success, false if template not found or extraction fails.
 */
export function writeDefaultFleetYaml(repoRoot: string): boolean {
  const doc = readDoc('templates', 'fleet-yaml');
  if (!doc) return false;
  const yamlMatch = doc.content.match(/```yaml\r?\n([\s\S]*?)```/);
  if (!yamlMatch) return false;
  const configDir = resolve(repoRoot, '.fleet');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolve(configDir, 'fleet.yaml'), yamlMatch[1]);
  return true;
}
