import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateDefaultManifest,
  mergeManifest,
  pruneStaleInternals,
  syncDocs,
  isDocsStale,
} from '../src/lib/doc-sync.js';
import { readProjectConfig, writeProjectConfig, readLocalState } from '../src/lib/paw-config.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('generateDefaultManifest', () => {
  it('returns internal-prefixed entries for bundled docs', () => {
    const manifest = generateDefaultManifest();
    const keys = Object.keys(manifest);

    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.startsWith('shortcuts/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('guidelines/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('templates/'))).toBe(true);

    for (const [key, value] of Object.entries(manifest)) {
      expect(value).toBe(`internal:${key}`);
    }
  });
});

describe('mergeManifest', () => {
  it('user entries override defaults', () => {
    const defaults = { 'shortcuts/a.md': 'internal:shortcuts/a.md' };
    const existing = { 'shortcuts/a.md': 'https://custom-url.com/a.md' };

    const merged = mergeManifest(existing, defaults);
    expect(merged['shortcuts/a.md']).toBe('https://custom-url.com/a.md');
  });

  it('adds new defaults not in existing', () => {
    const defaults = {
      'shortcuts/a.md': 'internal:shortcuts/a.md',
      'shortcuts/b.md': 'internal:shortcuts/b.md',
    };
    const existing = { 'shortcuts/a.md': 'internal:shortcuts/a.md' };

    const merged = mergeManifest(existing, defaults);
    expect(merged['shortcuts/b.md']).toBe('internal:shortcuts/b.md');
  });

  it('preserves user entries not in defaults', () => {
    const defaults = { 'shortcuts/a.md': 'internal:shortcuts/a.md' };
    const existing = { 'guidelines/custom.md': 'https://example.com/custom.md' };

    const merged = mergeManifest(existing, defaults);
    expect(merged['guidelines/custom.md']).toBe('https://example.com/custom.md');
    expect(merged['shortcuts/a.md']).toBe('internal:shortcuts/a.md');
  });
});

describe('pruneStaleInternals', () => {
  it('preserves valid internal entries', () => {
    const manifest = generateDefaultManifest();
    const firstKey = Object.keys(manifest)[0]!;
    const pruned = pruneStaleInternals({ [firstKey]: manifest[firstKey]! });
    expect(pruned[firstKey]).toBeDefined();
  });

  it('removes internal entries for non-existent bundled docs', () => {
    const manifest = { 'shortcuts/deleted-doc.md': 'internal:shortcuts/deleted-doc.md' };
    const pruned = pruneStaleInternals(manifest);
    expect(pruned['shortcuts/deleted-doc.md']).toBeUndefined();
  });

  it('preserves URL entries without checking', () => {
    const manifest = { 'guidelines/custom.md': 'https://example.com/custom.md' };
    const pruned = pruneStaleInternals(manifest);
    expect(pruned['guidelines/custom.md']).toBe('https://example.com/custom.md');
  });
});

describe('syncDocs', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('fresh sync copies all bundled docs and writes config.yml', () => {
    const result = syncDocs(repoRoot);

    expect(result.added.length).toBeGreaterThan(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);

    const config = readProjectConfig(repoRoot);
    expect(Object.keys(config.docs_cache.files).length).toBeGreaterThan(0);

    const firstKey = Object.keys(config.docs_cache.files)[0]!;
    expect(existsSync(resolve(repoRoot, '.paw', 'docs', firstKey))).toBe(true);
  });

  it('is idempotent — second run produces no changes', () => {
    syncDocs(repoRoot);
    const result = syncDocs(repoRoot);

    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('updates changed bundled docs', () => {
    syncDocs(repoRoot);

    const config = readProjectConfig(repoRoot);
    const internalKey = Object.keys(config.docs_cache.files).find((k) =>
      config.docs_cache.files[k]!.startsWith('internal:'),
    )!;
    const filePath = resolve(repoRoot, '.paw', 'docs', internalKey);
    writeFileSync(filePath, 'old content that differs from bundled', 'utf-8');

    const result = syncDocs(repoRoot);
    expect(result.updated).toContain(internalKey);
  });

  it('preserves user URL-sourced docs', () => {
    syncDocs(repoRoot);

    const userFile = resolve(repoRoot, '.paw', 'docs', 'shortcuts', 'user-doc.md');
    writeFileSync(userFile, '# User Doc\nContent here.', 'utf-8');
    const config = readProjectConfig(repoRoot);
    config.docs_cache.files['shortcuts/user-doc.md'] = 'https://example.com/user-doc.md';
    writeProjectConfig(repoRoot, config);

    const result = syncDocs(repoRoot);
    expect(existsSync(userFile)).toBe(true);
    expect(result.removed).not.toContain('shortcuts/user-doc.md');
  });

  it('preserves manual drop-ins with no config entry', () => {
    syncDocs(repoRoot);

    const dropIn = resolve(repoRoot, '.paw', 'docs', 'shortcuts', 'dropped.md');
    writeFileSync(dropIn, '# Dropped\nManually placed.', 'utf-8');

    const result = syncDocs(repoRoot);
    expect(existsSync(dropIn)).toBe(true);
    expect(result.removed).not.toContain('shortcuts/dropped.md');
  });

  it('removes files for pruned internal entries', () => {
    syncDocs(repoRoot);

    const config = readProjectConfig(repoRoot);
    config.docs_cache.files['shortcuts/old-removed.md'] = 'internal:shortcuts/old-removed.md';
    writeProjectConfig(repoRoot, config);
    const fakeFile = resolve(repoRoot, '.paw', 'docs', 'shortcuts', 'old-removed.md');
    writeFileSync(fakeFile, '# Old doc', 'utf-8');

    const result = syncDocs(repoRoot);
    expect(result.removed).toContain('shortcuts/old-removed.md');
    expect(existsSync(fakeFile)).toBe(false);
  });

  it('migrates .paw/custom/ into .paw/docs/', () => {
    const customDir = resolve(repoRoot, '.paw', 'custom', 'shortcuts');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'legacy-doc.md'), '# Legacy\nFrom custom dir.', 'utf-8');
    const customManifest = resolve(repoRoot, '.paw', 'custom', 'manifest.json');
    writeFileSync(
      customManifest,
      JSON.stringify({ 'shortcuts/legacy-doc.md': 'https://example.com/legacy.md' }),
      'utf-8',
    );

    syncDocs(repoRoot);

    expect(existsSync(resolve(repoRoot, '.paw', 'docs', 'shortcuts', 'legacy-doc.md'))).toBe(true);
    const config = readProjectConfig(repoRoot);
    expect(config.docs_cache.files['shortcuts/legacy-doc.md']).toBe(
      'https://example.com/legacy.md',
    );
    expect(existsSync(resolve(repoRoot, '.paw', 'custom'))).toBe(false);
  });

  it('migrates manifest.json to config.yml', () => {
    const docsDir = resolve(repoRoot, '.paw', 'docs');
    mkdirSync(docsDir, { recursive: true });
    const manifest: Record<string, string> = {
      'shortcuts/my-custom.md': 'https://example.com/my-custom.md',
    };
    writeFileSync(resolve(docsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    mkdirSync(resolve(docsDir, 'shortcuts'), { recursive: true });
    writeFileSync(resolve(docsDir, 'shortcuts', 'my-custom.md'), '# Custom Doc', 'utf-8');

    syncDocs(repoRoot);

    expect(existsSync(resolve(docsDir, 'manifest.json'))).toBe(false);
    const config = readProjectConfig(repoRoot);
    expect(config.docs_cache.files['shortcuts/my-custom.md']).toBe(
      'https://example.com/my-custom.md',
    );
  });

  it('updates state.yml with sync timestamp', () => {
    syncDocs(repoRoot);
    const state = readLocalState(repoRoot);
    expect(state.last_doc_sync_at).toBeDefined();
    expect(new Date(state.last_doc_sync_at!).getTime()).not.toBeNaN();
  });
});

describe('isDocsStale', () => {
  it('returns true when lastSyncAt is undefined', () => {
    expect(isDocsStale(undefined, 24)).toBe(true);
  });

  it('returns true when lastSyncAt is invalid', () => {
    expect(isDocsStale('not-a-date', 24)).toBe(true);
  });

  it('returns false when synced recently', () => {
    const recentSync = new Date().toISOString();
    expect(isDocsStale(recentSync, 24)).toBe(false);
  });

  it('returns true when sync is older than threshold', () => {
    const oldSync = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isDocsStale(oldSync, 24)).toBe(true);
  });

  it('respects custom threshold', () => {
    const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isDocsStale(halfHourAgo, 1)).toBe(false);
    expect(isDocsStale(halfHourAgo, 0.001)).toBe(true);
  });
});
