import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { readDoc, listDocs } from '../src/lib/docs.js';
import { writeProjectConfig } from '../src/lib/paw-config.js';
import type { PawProjectConfig } from '../src/lib/paw-config.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(repoRoot: string, config: PawProjectConfig): void {
  mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  writeProjectConfig(repoRoot, config);
}

describe('docs (single .paw/docs/ directory)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    vi.stubEnv('PAW_REPO_ROOT', repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('readDoc returns doc from .paw/docs/{category}/', () => {
    const docsDir = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      resolve(docsDir, 'my-shortcut.md'),
      '---\ntitle: My Shortcut\n---\n# Custom content',
      'utf-8',
    );

    const doc = readDoc('shortcuts', 'my-shortcut');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# Custom content');
  });

  it('readDoc returns null when doc does not exist', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'docs', 'shortcuts'), { recursive: true });
    const doc = readDoc('shortcuts', 'nonexistent');
    expect(doc).toBeNull();
  });

  it('readDoc returns null when .paw/docs/ does not exist', () => {
    const doc = readDoc('shortcuts', 'anything');
    expect(doc).toBeNull();
  });

  it('listDocs lists all docs in .paw/docs/{category}/', () => {
    const docsDir = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      resolve(docsDir, 'alpha.md'),
      '---\ntitle: Alpha\ndescription: First doc\n---\n# Alpha',
      'utf-8',
    );
    writeFileSync(
      resolve(docsDir, 'beta.md'),
      '---\ntitle: Beta\ndescription: Second doc\n---\n# Beta',
      'utf-8',
    );

    const docs = listDocs('shortcuts');
    expect(docs).toHaveLength(2);
    expect(docs[0]!.name).toBe('alpha');
    expect(docs[1]!.name).toBe('beta');
    expect(docs[0]!.description).toBe('First doc');
  });

  it('listDocs returns empty array when category directory missing', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'docs'), { recursive: true });
    const docs = listDocs('shortcuts');
    expect(docs).toHaveLength(0);
  });
});

describe('docs (lookup_path)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    vi.stubEnv('PAW_REPO_ROOT', repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('readDoc uses lookup_path in order — first match wins', () => {
    const dir1 = resolve(repoRoot, 'custom', 'shortcuts');
    const dir2 = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(resolve(dir1, 'my-doc.md'), '# From custom', 'utf-8');
    writeFileSync(resolve(dir2, 'my-doc.md'), '# From default', 'utf-8');

    writeConfig(repoRoot, {
      docs_cache: {
        files: {},
        lookup_path: ['custom/shortcuts', '.paw/docs/shortcuts'],
      },
      settings: { doc_auto_sync_hours: 24 },
    });

    const doc = readDoc('shortcuts', 'my-doc');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# From custom');
  });

  it('readDoc falls back to later paths when first has no match', () => {
    const dir1 = resolve(repoRoot, 'custom', 'shortcuts');
    const dir2 = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(resolve(dir2, 'fallback.md'), '# Fallback content', 'utf-8');

    writeConfig(repoRoot, {
      docs_cache: {
        files: {},
        lookup_path: ['custom/shortcuts', '.paw/docs/shortcuts'],
      },
      settings: { doc_auto_sync_hours: 24 },
    });

    const doc = readDoc('shortcuts', 'fallback');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# Fallback content');
  });

  it('listDocs deduplicates by name — first occurrence wins (shadowing)', () => {
    const dir1 = resolve(repoRoot, 'custom', 'shortcuts');
    const dir2 = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    writeFileSync(
      resolve(dir1, 'shared.md'),
      '---\ntitle: Custom Shared\ndescription: Override\n---\n# Custom',
      'utf-8',
    );
    writeFileSync(
      resolve(dir2, 'shared.md'),
      '---\ntitle: Default Shared\ndescription: Original\n---\n# Default',
      'utf-8',
    );
    writeFileSync(
      resolve(dir2, 'unique.md'),
      '---\ntitle: Unique\ndescription: Only here\n---\n# Unique',
      'utf-8',
    );

    writeConfig(repoRoot, {
      docs_cache: {
        files: {},
        lookup_path: ['custom/shortcuts', '.paw/docs/shortcuts'],
      },
      settings: { doc_auto_sync_hours: 24 },
    });

    const docs = listDocs('shortcuts');
    expect(docs).toHaveLength(2);
    const shared = docs.find((d) => d.name === 'shared')!;
    expect(shared.description).toBe('Override');
    expect(docs.find((d) => d.name === 'unique')).toBeDefined();
  });

  it('listDocs filters lookup_path by category', () => {
    const shortcutsDir = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    const guidelinesDir = resolve(repoRoot, '.paw', 'docs', 'guidelines');
    mkdirSync(shortcutsDir, { recursive: true });
    mkdirSync(guidelinesDir, { recursive: true });

    writeFileSync(
      resolve(shortcutsDir, 'a.md'),
      '---\ntitle: A\ndescription: Shortcut A\n---\n',
      'utf-8',
    );
    writeFileSync(
      resolve(guidelinesDir, 'b.md'),
      '---\ntitle: B\ndescription: Guideline B\n---\n',
      'utf-8',
    );

    writeConfig(repoRoot, {
      docs_cache: {
        files: {},
        lookup_path: ['.paw/docs/shortcuts', '.paw/docs/guidelines'],
      },
      settings: { doc_auto_sync_hours: 24 },
    });

    const shortcuts = listDocs('shortcuts');
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]!.name).toBe('a');

    const guidelines = listDocs('guidelines');
    expect(guidelines).toHaveLength(1);
    expect(guidelines[0]!.name).toBe('b');
  });

  it('falls back to default path when no lookup_path configured', () => {
    const docsDir = resolve(repoRoot, '.paw', 'docs', 'shortcuts');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(resolve(docsDir, 'test.md'), '# Test', 'utf-8');

    // No config.yml at all
    const doc = readDoc('shortcuts', 'test');
    expect(doc).not.toBeNull();
    expect(doc!.content).toBe('# Test');
  });
});
