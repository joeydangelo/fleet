import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

import {
  readManifest,
  writeManifest,
  readLocalState,
  writeLocalState,
} from '../src/lib/manifest.js';
import type { FleetManifest, LocalState } from '../src/lib/manifest.js';
import { makeTempDir } from './helpers/temp.js';

describe('readManifest', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns defaults when manifest.yml is missing', () => {
    const manifest = readManifest(repoRoot);
    expect(manifest.docs_cache.files).toEqual({});
    expect(manifest.docs_cache.lookup_path).toEqual([
      '.fleet/docs/shortcuts',
      '.fleet/docs/guidelines',
      '.fleet/docs/templates',
    ]);
    expect(manifest.settings.doc_auto_sync_hours).toBe(24);
  });

  it('reads existing manifest.yml', () => {
    writeFileSync(
      resolve(repoRoot, '.fleet', 'manifest.yml'),
      'docs_cache:\n  files:\n    shortcuts/foo.md: "https://example.com/foo.md"\nsettings:\n  doc_auto_sync_hours: 12\n',
      'utf-8',
    );
    const manifest = readManifest(repoRoot);
    expect(manifest.docs_cache.files['shortcuts/foo.md']).toBe('https://example.com/foo.md');
    expect(manifest.settings.doc_auto_sync_hours).toBe(12);
  });

  it('fills in defaults for partial manifest', () => {
    writeFileSync(
      resolve(repoRoot, '.fleet', 'manifest.yml'),
      'docs_cache:\n  files:\n    a.md: internal:a.md\n',
      'utf-8',
    );
    const manifest = readManifest(repoRoot);
    expect(manifest.docs_cache.files['a.md']).toBe('internal:a.md');
    expect(manifest.settings.doc_auto_sync_hours).toBe(24);
  });
});

describe('writeManifest + readManifest round-trip', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('round-trips correctly', () => {
    const manifest: FleetManifest = {
      docs_cache: {
        files: {
          'shortcuts/build-task.md': 'internal:shortcuts/build-task.md',
          'guidelines/custom.md': 'https://example.com/custom.md',
        },
        lookup_path: ['.fleet/docs/shortcuts', '.fleet/docs/guidelines', '.fleet/docs/templates'],
      },
      settings: { doc_auto_sync_hours: 48 },
    };
    writeManifest(repoRoot, manifest);

    const read = readManifest(repoRoot);
    expect(read.docs_cache.files).toEqual(manifest.docs_cache.files);
    expect(read.docs_cache.lookup_path).toEqual(manifest.docs_cache.lookup_path);
    expect(read.settings.doc_auto_sync_hours).toBe(48);
  });

  it('writes valid YAML to manifest.yml', () => {
    const manifest: FleetManifest = {
      docs_cache: {
        files: { 'a.md': 'internal:a.md' },
        lookup_path: ['.fleet/docs/shortcuts'],
      },
      settings: { doc_auto_sync_hours: 24 },
    };
    writeManifest(repoRoot, manifest);

    const raw = readFileSync(resolve(repoRoot, '.fleet', 'manifest.yml'), 'utf-8');
    expect(raw).toContain('docs_cache');
    expect(raw).toContain('a.md');
  });
});

describe('readLocalState', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns empty state when state.yml is missing', () => {
    const state = readLocalState(repoRoot);
    expect(state.last_doc_sync_at).toBeUndefined();
  });

  it('reads existing state.yml from .fleet/run/', () => {
    mkdirSync(resolve(repoRoot, '.fleet', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.fleet', 'run', 'state.yml'),
      'last_doc_sync_at: "2026-02-24T12:00:00Z"\n',
      'utf-8',
    );
    const state = readLocalState(repoRoot);
    expect(state.last_doc_sync_at).toBe('2026-02-24T12:00:00Z');
  });
});

describe('writeLocalState + readLocalState round-trip', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('round-trips correctly', () => {
    const state: LocalState = { last_doc_sync_at: '2026-02-24T12:00:00Z' };
    writeLocalState(repoRoot, state);

    const read = readLocalState(repoRoot);
    expect(read.last_doc_sync_at).toBe('2026-02-24T12:00:00Z');
  });
});
