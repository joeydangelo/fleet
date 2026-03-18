import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readManifest, writeManifest, readLocalState, writeLocalState } from './manifest.js';
import { fetchWithGhFallback } from './github-fetch.js';
import { toErrorMessage } from './output.js';
import { findBundledDir } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INTERNAL_PREFIX = 'internal:';

interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  skipped: string[];
}

/**
 * Resolve the bundled docs base directory. Checks dist/docs/ first,
 * falls back to src/docs/ for local development.
 */
function getDocsBasePath(): string {
  const result = findBundledDir(__dirname, 'docs');
  if (!result) throw new Error('fleet docs not found');
  return result;
}

/** Scan bundled docs and return a manifest of internal entries. */
export function generateDefaultManifest(): Record<string, string> {
  const manifest: Record<string, string> = {};
  let docsDir: string;
  try {
    docsDir = getDocsBasePath();
  } catch (err) {
    console.warn(
      `[fleet] Could not resolve docs base path: ${err instanceof Error ? err.message : String(err)}`,
    );
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

/** User entries take precedence over bundled defaults. */
export function mergeManifest(
  existing: Record<string, string>,
  defaults: Record<string, string>,
): Record<string, string> {
  return { ...defaults, ...existing };
}

/** Drop entries for docs that were removed from the bundled package. */
export function pruneStaleInternals(manifest: Record<string, string>): Record<string, string> {
  let docsDir: string;
  try {
    docsDir = getDocsBasePath();
  } catch (err) {
    console.warn(
      `[fleet] Could not resolve docs base path for pruning: ${err instanceof Error ? err.message : String(err)}`,
    );
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

/**
 * Sync bundled docs to .fleet/docs/, preserving user-added and dropped-in docs.
 * Writes doc entries to manifest.yml.
 */
export function syncDocs(repoRoot: string): SyncResult {
  const docsDir = join(repoRoot, '.fleet', 'docs');
  mkdirSync(docsDir, { recursive: true });

  const manifest = readManifest(repoRoot);
  const existing: Record<string, string> = { ...manifest.docs_cache.files };

  const defaults = generateDefaultManifest();
  const merged = mergeManifest(existing, defaults);
  const final = pruneStaleInternals(merged);

  const prunedKeys = new Set(Object.keys(merged).filter((k) => !(k in final)));

  const added: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];

  let bundledDocsDir: string;
  try {
    bundledDocsDir = getDocsBasePath();
  } catch (err) {
    console.warn(
      `[fleet] Could not resolve docs base path during sync: ${err instanceof Error ? err.message : String(err)}`,
    );
    writeManifest(repoRoot, { ...manifest, docs_cache: { ...manifest.docs_cache, files: final } });
    return { added, updated, removed, skipped };
  }

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

  // Remove only files that were previously tracked but pruned from the manifest.
  // Untracked drop-ins (manual files with no manifest entry) are preserved.
  for (const key of prunedKeys) {
    const destPath = join(docsDir, key);
    if (existsSync(destPath)) {
      unlinkSync(destPath);
      removed.push(key);
    }
  }

  writeManifest(repoRoot, { ...manifest, docs_cache: { ...manifest.docs_cache, files: final } });

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

/** Re-fetch URL-sourced docs and update on-disk copies if changed. Returns keys that failed. */
async function refreshUrlDocs(repoRoot: string): Promise<string[]> {
  const manifest = readManifest(repoRoot);
  const docsDir = join(repoRoot, '.fleet', 'docs');

  const urlEntries = Object.entries(manifest.docs_cache.files).filter(
    ([, source]) => !source.startsWith(INTERNAL_PREFIX),
  );

  const results = await Promise.allSettled(
    urlEntries.map(async ([key, source]) => {
      const { content } = await fetchWithGhFallback(source);
      const destPath = join(docsDir, key);
      mkdirSync(dirname(destPath), { recursive: true });
      if (!existsSync(destPath) || readFileSync(destPath, 'utf-8') !== content) {
        writeFileSync(destPath, content, 'utf-8');
      }
      return key;
    }),
  );

  const failed: string[] = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((_, i) => urlEntries[i]![0]);

  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const key = urlEntries[i]![0];
      const msg = toErrorMessage(result.reason);
      console.warn(`[fleet] Failed to refresh URL doc "${key}": ${msg}`);
    }
  }

  return failed;
}

/**
 * Auto-sync entry point: checks staleness, runs full sync if needed.
 * Safe to call from any command — errors are swallowed.
 */
export async function ensureDocsFresh(repoRoot: string): Promise<void> {
  const state = readLocalState(repoRoot);
  const manifest = readManifest(repoRoot);
  const hours = manifest.settings.doc_auto_sync_hours;

  if (!isDocsStale(state.last_doc_sync_at, hours)) return;

  syncDocs(repoRoot);
  const failed = await refreshUrlDocs(repoRoot);

  const now = new Date().toISOString();
  if (failed.length > 0) {
    console.warn(
      `[fleet] URL doc sync partially failed (${failed.length} entries). Updating timestamp despite failures.`,
    );
  }
  writeLocalState(repoRoot, { ...state, last_doc_sync_at: now });
}
