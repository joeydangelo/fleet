import { describe, it, expect, vi, afterEach } from 'vitest';

import { githubBlobToRawUrl, directFetch, fetchWithGhFallback } from '../src/lib/github-fetch.js';

describe('githubBlobToRawUrl', () => {
  it('converts blob URL to raw URL', () => {
    expect(githubBlobToRawUrl('https://github.com/org/repo/blob/main/docs/file.md')).toBe(
      'https://raw.githubusercontent.com/org/repo/main/docs/file.md',
    );
  });

  it('passes through raw URLs unchanged', () => {
    const raw = 'https://raw.githubusercontent.com/org/repo/main/docs/file.md';
    expect(githubBlobToRawUrl(raw)).toBe(raw);
  });

  it('passes through non-GitHub URLs unchanged', () => {
    const url = 'https://example.com/docs/file.md';
    expect(githubBlobToRawUrl(url)).toBe(url);
  });

  it('handles nested paths', () => {
    expect(
      githubBlobToRawUrl('https://github.com/org/repo/blob/v2/src/docs/guidelines/rules.md'),
    ).toBe('https://raw.githubusercontent.com/org/repo/v2/src/docs/guidelines/rules.md');
  });
});

describe('directFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns body on 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('# My Doc\nContent here'),
    });

    const result = await directFetch('https://example.com/doc.md');
    expect(result).toBe('# My Doc\nContent here');
  });

  it('throws on non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(directFetch('https://example.com/missing.md')).rejects.toThrow('HTTP 404');
  });

  it('throws on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    await expect(directFetch('https://example.com/doc.md')).rejects.toThrow('Network failure');
  });
});

describe('fetchWithGhFallback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns direct fetch result on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('content'),
    });

    const result = await fetchWithGhFallback('https://example.com/doc.md');
    expect(result).toEqual({ content: 'content', usedGhCli: false });
  });

  it('converts blob URL before fetching', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('content'),
    });

    await fetchWithGhFallback('https://github.com/org/repo/blob/main/doc.md');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/org/repo/main/doc.md',
      expect.any(Object),
    );
  });

  it('re-throws non-403 errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(fetchWithGhFallback('https://example.com/doc.md')).rejects.toThrow('HTTP 500');
  });
});
