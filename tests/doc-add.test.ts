import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDocContent, getDocTypeSubdir, addDoc } from '../src/lib/doc-add.js';

// Mock github-fetch so no network calls
vi.mock('../src/lib/github-fetch.js', () => ({
  githubBlobToRawUrl: (url: string) =>
    url.replace('/blob/', '/').replace('github.com', 'raw.githubusercontent.com'),
  fetchWithGhFallback: vi.fn(),
}));

import { fetchWithGhFallback } from '../src/lib/github-fetch.js';

const mockedFetch = vi.mocked(fetchWithGhFallback);

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

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

describe('getDocTypeSubdir', () => {
  it('maps guideline to guidelines', () => {
    expect(getDocTypeSubdir('guideline')).toBe('guidelines');
  });

  it('maps shortcut to shortcuts', () => {
    expect(getDocTypeSubdir('shortcut')).toBe('shortcuts');
  });

  it('maps template to templates', () => {
    expect(getDocTypeSubdir('template')).toBe('templates');
  });
});

describe('addDoc', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mockedFetch.mockReset();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes doc to .paw/custom/{category}/', async () => {
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
    const filePath = resolve(repoRoot, '.paw', 'custom', 'guidelines', 'my-guide.md');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toContain('# Guide');
  });

  it('updates manifest.json with source URL', async () => {
    mockedFetch.mockResolvedValue({ content: '# Doc\nContent here.', usedGhCli: false });

    await addDoc(repoRoot, {
      url: 'https://example.com/shortcut.md',
      name: 'my-shortcut',
      docType: 'shortcut',
    });

    const manifestPath = resolve(repoRoot, '.paw', 'custom', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest['shortcuts/my-shortcut.md']).toBe('https://example.com/shortcut.md');
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

  it('preserves existing manifest entries', async () => {
    // Write an existing manifest
    const customDir = resolve(repoRoot, '.paw', 'custom');
    mkdirSync(customDir, { recursive: true });
    const { writeFileSync } = await import('atomically');
    writeFileSync(
      resolve(customDir, 'manifest.json'),
      JSON.stringify({ 'guidelines/old.md': 'https://example.com/old.md' }),
    );

    mockedFetch.mockResolvedValue({ content: '# New\nContent here.', usedGhCli: false });

    await addDoc(repoRoot, {
      url: 'https://example.com/new.md',
      name: 'new',
      docType: 'guideline',
    });

    const manifest = JSON.parse(readFileSync(resolve(customDir, 'manifest.json'), 'utf-8'));
    expect(manifest['guidelines/old.md']).toBe('https://example.com/old.md');
    expect(manifest['guidelines/new.md']).toBe('https://example.com/new.md');
  });
});
