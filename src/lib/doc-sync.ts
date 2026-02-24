import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { writeFileSync } from 'atomically';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readProjectConfig,
  writeProjectConfig,
  readLocalState,
  writeLocalState,
} from './paw-config.js';
import { fetchWithGhFallback } from './github-fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INTERNAL_PREFIX = 'internal:';

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
}

/**
 * Resolve the bundled docs base directory. Checks dist/docs/ first,
 * falls back to src/docs/ for local development.
 */
export function getDocsBasePath(): string {
  const candidates = [
    join(__dirname, 'docs'),
    join(__dirname, '..', 'src', 'docs'),
    join(__dirname, '..', 'docs'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('paw docs not found');
}

/** Scan bundled docs and return a manifest of internal entries. */
export function generateDefaultManifest(): Record<string, string> {
  const manifest: Record<string, string> = {};
  let docsDir: string;
  try {
    docsDir = getDocsBasePath();
  } catch {
    return manifest;
  }

  const categories = ['shortcuts', 'guidelines', 'templates'];
  for (const category of categories) {
    const dir = join(docsDir, category);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const key = `${category}/${file}`;
      manifest[key] = `${INTERNAL_PREFIX}${key}`;
    }
  }
  return manifest;
}

/** Merge existing manifest with defaults. User entries win. */
export function mergeManifest(
  existing: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  return { ...defaults, ...existing };
}

/** Remove internal entries whose bundled source no longer exists. */
export function pruneStaleInternals(manifest: Record<string, string>): Record<string, string> {
  let docsDir: string;
  try {
    docsDir = getDocsBasePath();
  } catch {
    return manifest;
  }

  const result: Record<string, string> = {};
  for (const [key, source] of Object.entries(manifest)) {
    if (source.startsWith(INTERNAL_PREFIX)) {
      const relativePath = source.slice(INTERNAL_PREFIX.length);
      if (existsSync(join(docsDir, relativePath))) {
        result[key] = source;
      }
    } else {
      result[key] = source;
    }
  }
  return result;
}

/** Migrate .paw/custom/ into .paw/docs/ (one-time backward compat). */
function migrateCustomDir(repoRoot: string, docsDir: string): Record<string, string> {
  const customPath = join(repoRoot, '.paw', 'custom');
  if (!existsSync(customPath)) return {};

  let customManifest: Record<string, string> = {};
  const customManifestPath = join(customPath, 'manifest.json');
  if (existsSync(customManifestPath)) {
    try {
      customManifest = JSON.parse(readFileSync(customManifestPath, 'utf-8')) as Record<
        string,
        string
      >;
    } catch {
      // Corrupted — skip
    }
  }

  for (const category of ['shortcuts', 'guidelines', 'templates']) {
    const srcDir = join(customPath, category);
    if (!existsSync(srcDir)) continue;
    const destDir = join(docsDir, category);
    mkdirSync(destDir, { recursive: true });
    for (const file of readdirSync(srcDir)) {
      if (!file.endsWith('.md')) continue;
      const src = join(srcDir, file);
      const dest = join(destDir, file);
      if (!existsSync(dest)) {
        cpSync(src, dest);
      }
    }
  }

  rmSync(customPath, { recursive: true, force: true });
  return customManifest;
}

/**
 * Migrate manifest.json entries into config.yml.
 * Called once if manifest.json exists and config.yml has no files.
 */
function migrateManifestJson(repoRoot: string): Record<string, string> {
  const manifestPath = join(repoRoot, '.paw', 'docs', 'manifest.json');
  if (!existsSync(manifestPath)) return {};

  const config = readProjectConfig(repoRoot);
  // Only migrate if config.yml has no files yet
  if (Object.keys(config.docs_cache.files).length > 0) return {};

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, string>;
    unlinkSync(manifestPath);
    return manifest;
  } catch {
    return {};
  }
}

/**
 * Sync bundled docs to .paw/docs/, preserving user-added and dropped-in docs.
 * Writes doc entries to config.yml instead of manifest.json.
 */
export function syncDocs(repoRoot: string): SyncResult {
  const docsDir = join(repoRoot, '.paw', 'docs');
  mkdirSync(docsDir, { recursive: true });

  // Migrate legacy .paw/custom/ if present
  const migratedEntries = migrateCustomDir(repoRoot, docsDir);

  // Migrate manifest.json → config.yml if needed
  const manifestEntries = migrateManifestJson(repoRoot);

  // Read existing files from config.yml
  const config = readProjectConfig(repoRoot);
  let existing: Record<string, string> = { ...config.docs_cache.files };

  // Merge migrated entries
  existing = { ...existing, ...migratedEntries, ...manifestEntries };

  // Generate defaults, merge, prune
  const defaults = generateDefaultManifest();
  const merged = mergeManifest(existing, defaults);
  const final = pruneStaleInternals(merged);

  // Determine pruned entries (in merged but not in final)
  const prunedKeys = Object.keys(merged).filter((k) => !(k in final));

  const added: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];

  let bundledDocsDir: string;
  try {
    bundledDocsDir = getDocsBasePath();
  } catch {
    writeProjectConfig(repoRoot, { ...config, docs_cache: { ...config.docs_cache, files: final } });
    return { added, updated, removed, skipped };
  }

  // Sync each entry
  for (const [key, source] of Object.entries(final)) {
    if (!source.startsWith(INTERNAL_PREFIX)) {
      skipped.push(key);
      continue;
    }

    const relativePath = source.slice(INTERNAL_PREFIX.length);
    const bundledPath = join(bundledDocsDir, relativePath);
    const destPath = join(docsDir, key);

    if (!existsSync(bundledPath)) {
      skipped.push(key);
      continue;
    }

    const bundledContent = readFileSync(bundledPath, 'utf-8');
    mkdirSync(dirname(destPath), { recursive: true });

    if (!existsSync(destPath)) {
      writeFileSync(destPath, bundledContent, 'utf-8');
      added.push(key);
    } else {
      const currentContent = readFileSync(destPath, 'utf-8');
      if (currentContent !== bundledContent) {
        writeFileSync(destPath, bundledContent, 'utf-8');
        updated.push(key);
      } else {
        skipped.push(key);
      }
    }
  }

  // Remove files for pruned internal entries
  for (const key of prunedKeys) {
    const filePath = join(docsDir, key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      removed.push(key);
    }
  }

  // Write final state to config.yml
  writeProjectConfig(repoRoot, { ...config, docs_cache: { ...config.docs_cache, files: final } });

  // Update local state with sync timestamp
  const state = readLocalState(repoRoot);
  writeLocalState(repoRoot, { ...state, last_doc_sync_at: new Date().toISOString() });

  return { added, updated, removed, skipped };
}

/** Check whether docs are stale based on last sync time and threshold. */
export function isDocsStale(lastSyncAt: string | undefined, autoSyncHours: number): boolean {
  if (!lastSyncAt) return true;
  const lastSync = new Date(lastSyncAt).getTime();
  if (isNaN(lastSync)) return true;
  const thresholdMs = autoSyncHours * 60 * 60 * 1000;
  return Date.now() - lastSync > thresholdMs;
}

/** Re-fetch URL-sourced docs and update on-disk copies if changed. */
async function refreshUrlDocs(repoRoot: string): Promise<void> {
  const config = readProjectConfig(repoRoot);
  const docsDir = join(repoRoot, '.paw', 'docs');

  for (const [key, source] of Object.entries(config.docs_cache.files)) {
    if (source.startsWith(INTERNAL_PREFIX)) continue;

    try {
      const { content } = await fetchWithGhFallback(source);
      const destPath = join(docsDir, key);
      mkdirSync(dirname(destPath), { recursive: true });

      if (!existsSync(destPath) || readFileSync(destPath, 'utf-8') !== content) {
        writeFileSync(destPath, content, 'utf-8');
      }
    } catch {
      // Network failures skip silently per-entry
    }
  }
}

/**
 * Auto-sync entry point: checks staleness, runs full sync if needed.
 * Safe to call from any command — errors are swallowed.
 */
export async function ensureDocsFresh(repoRoot: string): Promise<void> {
  const state = readLocalState(repoRoot);
  const config = readProjectConfig(repoRoot);
  const hours = config.settings.doc_auto_sync_hours;

  if (!isDocsStale(state.last_doc_sync_at, hours)) return;

  syncDocs(repoRoot);
  await refreshUrlDocs(repoRoot);

  writeLocalState(repoRoot, {
    ...readLocalState(repoRoot),
    last_doc_sync_at: new Date().toISOString(),
  });
}
