import { existsSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { readDoc } from './docs.js';

/** Return a promise that resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a duration in milliseconds as a human-readable string. */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Walk __dirname-relative candidates to find a bundled directory.
 * Returns the first existing path, or null if none found.
 */
export function findBundledDir(base: string, name: string): string | null {
  const candidates = [
    resolve(base, name),
    resolve(base, '..', name),
    resolve(base, '..', '..', name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Extract the paw.yaml template from bundled docs and write it to .paw/paw.yaml.
 * Returns true if written, false if skipped (template not found or extraction failed).
 */
export function writeDefaultPawYaml(repoRoot: string): boolean {
  const doc = readDoc('templates', 'paw-yaml');
  if (!doc) return false;
  const yamlMatch = doc.content.match(/```yaml\r?\n([\s\S]*?)```/);
  if (!yamlMatch) return false;
  const configDir = resolve(repoRoot, '.paw');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(resolve(configDir, 'paw.yaml'), yamlMatch[1]);
  return true;
}
