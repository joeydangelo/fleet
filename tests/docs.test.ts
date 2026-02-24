import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { readDoc, listDocs } from '../src/lib/docs.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('custom doc shadowing', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    // Mock getRepoRoot to return our temp dir
    vi.stubEnv('PAW_REPO_ROOT', repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('readDoc returns custom doc when it exists', () => {
    const customDir = resolve(repoRoot, '.paw', 'custom', 'shortcuts');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      resolve(customDir, 'my-shortcut.md'),
      '---\ntitle: Custom Shortcut\n---\n# Custom content',
      'utf-8',
    );

    const doc = readDoc('shortcuts', 'my-shortcut');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# Custom content');
  });

  it('readDoc falls back to bundled doc when no custom exists', () => {
    // No custom docs, should find bundled getting-started
    const doc = readDoc('shortcuts', 'getting-started');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('Getting Started');
  });

  it('readDoc custom doc shadows bundled doc of same name', () => {
    const customDir = resolve(repoRoot, '.paw', 'custom', 'shortcuts');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      resolve(customDir, 'getting-started.md'),
      '---\ntitle: My Getting Started\n---\n# Overridden',
      'utf-8',
    );

    const doc = readDoc('shortcuts', 'getting-started');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# Overridden');
  });

  it('listDocs includes both custom and bundled docs', () => {
    const customDir = resolve(repoRoot, '.paw', 'custom', 'shortcuts');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      resolve(customDir, 'my-custom.md'),
      '---\ntitle: My Custom\ndescription: A custom shortcut\n---\n# Body',
      'utf-8',
    );

    const docs = listDocs('shortcuts');
    const names = docs.map((d) => d.name);
    expect(names).toContain('my-custom');
    // Should also have bundled docs
    expect(names).toContain('getting-started');
  });

  it('listDocs does not duplicate when custom shadows bundled', () => {
    const customDir = resolve(repoRoot, '.paw', 'custom', 'shortcuts');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      resolve(customDir, 'getting-started.md'),
      '---\ntitle: Custom Getting Started\n---\n# Override',
      'utf-8',
    );

    const docs = listDocs('shortcuts');
    const gettingStartedDocs = docs.filter((d) => d.name === 'getting-started');
    expect(gettingStartedDocs).toHaveLength(1);
    expect(gettingStartedDocs[0]!.title).toBe('Custom Getting Started');
  });
});
