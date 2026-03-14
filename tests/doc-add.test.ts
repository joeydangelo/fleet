import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateDocContent, addDoc, injectRolesFrontmatter } from '../src/lib/doc-add.js';
import { readManifest, writeManifest } from '../src/lib/manifest.js';

// Mock github-fetch so no network calls
vi.mock('../src/lib/github-fetch.js', () => ({
  githubBlobToRawUrl: (url: string) =>
    url.replace('/blob/', '/').replace('github.com', 'raw.githubusercontent.com'),
  fetchWithGhFallback: vi.fn(),
}));

import { fetchWithGhFallback } from '../src/lib/github-fetch.js';

const mockedFetch = vi.mocked(fetchWithGhFallback);

import { makeTempDir } from './helpers/temp.js';

describe('validateDocContent', () => {
  it('accepts valid markdown', () => {
    expect(() => validateDocContent('# My Doc\nSome content here', 'test')).not.toThrow();
  });

  it('rejects empty content', () => {
    expect(() => validateDocContent('', 'test')).toThrow('empty');
  });

  it('rejects whitespace-only content', () => {
    expect(() => validateDocContent('   \n  ', 'test')).toThrow('empty');
  });

  it('rejects content that is too short', () => {
    expect(() => validateDocContent('hi', 'test')).toThrow('too short');
  });

  it('rejects HTML pages', () => {
    expect(() => validateDocContent('<!DOCTYPE html><html>...</html>', 'test')).toThrow('HTML');
  });

  it('rejects content starting with <html', () => {
    expect(() => validateDocContent('<html><body>page</body></html>', 'test')).toThrow('HTML');
  });
});

describe('addDoc', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
    mockedFetch.mockReset();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes doc to .paw/docs/{category}/', async () => {
    mockedFetch.mockResolvedValue({
      content: '---\ntitle: My Guideline\n---\n# Guide\nContent',
      usedGhCli: false,
    });

    const result = await addDoc(repoRoot, {
      url: 'https://example.com/my-guide.md',
      name: 'my-guide',
      docType: 'guideline',
    });

    expect(result.destPath).toBe('guidelines/my-guide.md');
    const filePath = resolve(repoRoot, '.paw', 'docs', 'guidelines', 'my-guide.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('updates manifest.yml with source URL', async () => {
    mockedFetch.mockResolvedValue({ content: '# Doc\nContent here.', usedGhCli: false });

    await addDoc(repoRoot, {
      url: 'https://example.com/shortcut.md',
      name: 'my-shortcut',
      docType: 'shortcut',
    });

    const config = readManifest(repoRoot);
    expect(config.docs_cache.files['shortcuts/my-shortcut.md']).toBe(
      'https://example.com/shortcut.md',
    );
  });

  it('strips .md from name', async () => {
    mockedFetch.mockResolvedValue({ content: '# Doc\nContent here.', usedGhCli: false });

    const result = await addDoc(repoRoot, {
      url: 'https://example.com/doc.md',
      name: 'my-doc.md',
      docType: 'template',
    });

    expect(result.destPath).toBe('templates/my-doc.md');
  });

  it('reports usedGhCli from fetch result', async () => {
    mockedFetch.mockResolvedValue({ content: '# Doc\nContent here.', usedGhCli: true });

    const result = await addDoc(repoRoot, {
      url: 'https://github.com/org/repo/blob/main/doc.md',
      name: 'doc',
      docType: 'guideline',
    });

    expect(result.usedGhCli).toBe(true);
  });

  it('throws on validation failure', async () => {
    mockedFetch.mockResolvedValue({ content: '', usedGhCli: false });

    await expect(
      addDoc(repoRoot, { url: 'https://example.com/empty.md', name: 'empty', docType: 'shortcut' }),
    ).rejects.toThrow('empty');
  });

  it('preserves existing config entries', async () => {
    // Write an existing config with an entry
    writeManifest(repoRoot, {
      docs_cache: {
        files: { 'guidelines/old.md': 'https://example.com/old.md' },
        lookup_path: ['.paw/docs/shortcuts', '.paw/docs/guidelines', '.paw/docs/templates'],
      },
      settings: { doc_auto_sync_hours: 24 },
    });

    mockedFetch.mockResolvedValue({ content: '# New\nContent here.', usedGhCli: false });

    await addDoc(repoRoot, {
      url: 'https://example.com/new.md',
      name: 'new',
      docType: 'guideline',
    });

    const config = readManifest(repoRoot);
    expect(config.docs_cache.files['guidelines/old.md']).toBe('https://example.com/old.md');
    expect(config.docs_cache.files['guidelines/new.md']).toBe('https://example.com/new.md');
  });

  it('injects roles into fetched doc frontmatter when --roles provided', async () => {
    mockedFetch.mockResolvedValue({
      content: '---\nname: security-audit\ndescription: Security checklist\n---\n# Audit',
      usedGhCli: false,
    });

    await addDoc(repoRoot, {
      url: 'https://example.com/audit.md',
      name: 'security-audit',
      docType: 'guideline',
      roles: ['reviewer'],
    });

    const { readFileSync } = await import('node:fs');
    const content = readFileSync(
      resolve(repoRoot, '.paw', 'docs', 'guidelines', 'security-audit.md'),
      'utf-8',
    );
    expect(content).toContain('roles: [reviewer]');
  });
});

describe('injectRolesFrontmatter', () => {
  it('appends roles to existing frontmatter', () => {
    const input = '---\nname: test\ndescription: A test\n---\n# Body';
    const result = injectRolesFrontmatter(input, ['builder', 'reviewer']);
    expect(result).toContain('roles: [builder, reviewer]');
    expect(result).toContain('name: test');
    expect(result).toContain('# Body');
  });

  it('replaces existing roles field', () => {
    const input = '---\nname: test\nroles: [orchestrator]\n---\n# Body';
    const result = injectRolesFrontmatter(input, ['builder']);
    expect(result).toContain('roles: [builder]');
    expect(result).not.toContain('orchestrator');
  });

  it('wraps content with frontmatter when none exists', () => {
    const input = '# No frontmatter\nJust content.';
    const result = injectRolesFrontmatter(input, ['reviewer']);
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('roles: [reviewer]');
    expect(result).toContain('# No frontmatter');
  });
});
