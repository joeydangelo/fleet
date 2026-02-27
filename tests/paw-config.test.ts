import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

import {
  readProjectConfig,
  writeProjectConfig,
  readLocalState,
  writeLocalState,
} from '../src/lib/paw-config.js';
import type { PawProjectConfig, LocalState } from '../src/lib/paw-config.js';
import { makeTempDir } from './helpers/temp.js';

describe('readProjectConfig', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns defaults when config.yml is missing', () => {
    const config = readProjectConfig(repoRoot);
    expect(config.docs_cache.files).toEqual({});
    expect(config.docs_cache.lookup_path).toEqual([
      '.paw/docs/shortcuts',
      '.paw/docs/guidelines',
      '.paw/docs/templates',
    ]);
    expect(config.settings.doc_auto_sync_hours).toBe(24);
  });

  it('reads existing config.yml', () => {
    writeFileSync(
      resolve(repoRoot, '.paw', 'config.yml'),
      'docs_cache:\n  files:\n    shortcuts/foo.md: "https://example.com/foo.md"\nsettings:\n  doc_auto_sync_hours: 12\n',
      'utf-8',
    );
    const config = readProjectConfig(repoRoot);
    expect(config.docs_cache.files['shortcuts/foo.md']).toBe('https://example.com/foo.md');
    expect(config.settings.doc_auto_sync_hours).toBe(12);
  });

  it('fills in defaults for partial config', () => {
    writeFileSync(
      resolve(repoRoot, '.paw', 'config.yml'),
      'docs_cache:\n  files:\n    a.md: internal:a.md\n',
      'utf-8',
    );
    const config = readProjectConfig(repoRoot);
    expect(config.docs_cache.files['a.md']).toBe('internal:a.md');
    expect(config.settings.doc_auto_sync_hours).toBe(24);
  });
});

describe('writeProjectConfig + readProjectConfig round-trip', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('round-trips correctly', () => {
    const config: PawProjectConfig = {
      docs_cache: {
        files: {
          'shortcuts/build-task.md': 'internal:shortcuts/build-task.md',
          'guidelines/custom.md': 'https://example.com/custom.md',
        },
        lookup_path: ['.paw/docs/shortcuts', '.paw/docs/guidelines', '.paw/docs/templates'],
      },
      settings: { doc_auto_sync_hours: 48 },
    };
    writeProjectConfig(repoRoot, config);

    const read = readProjectConfig(repoRoot);
    expect(read.docs_cache.files).toEqual(config.docs_cache.files);
    expect(read.docs_cache.lookup_path).toEqual(config.docs_cache.lookup_path);
    expect(read.settings.doc_auto_sync_hours).toBe(48);
  });

  it('writes valid YAML', () => {
    const config: PawProjectConfig = {
      docs_cache: {
        files: { 'a.md': 'internal:a.md' },
        lookup_path: ['.paw/docs/shortcuts'],
      },
      settings: { doc_auto_sync_hours: 24 },
    };
    writeProjectConfig(repoRoot, config);

    const raw = readFileSync(resolve(repoRoot, '.paw', 'config.yml'), 'utf-8');
    expect(raw).toContain('docs_cache');
    expect(raw).toContain('a.md');
  });
});

describe('readLocalState', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns empty state when state.yml is missing', () => {
    const state = readLocalState(repoRoot);
    expect(state.last_doc_sync_at).toBeUndefined();
  });

  it('reads existing state.yml from .paw/run/', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', 'state.yml'),
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
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
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
