import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { formatElapsed, findBundledDir } from '../src/lib/util.js';

describe('formatElapsed', () => {
  it('formats sub-minute durations as seconds only', () => {
    expect(formatElapsed(5_000)).toBe('5s');
    expect(formatElapsed(45_000)).toBe('45s');
  });

  it('formats durations over a minute as Xm Ys', () => {
    expect(formatElapsed(90_000)).toBe('1m 30s');
    expect(formatElapsed(125_000)).toBe('2m 5s');
  });

  it('uses Math.floor (no decimals)', () => {
    expect(formatElapsed(1_999)).toBe('1s');
    expect(formatElapsed(61_500)).toBe('1m 1s');
  });

  it('formats zero', () => {
    expect(formatElapsed(0)).toBe('0s');
  });
});

describe('findBundledDir', () => {
  it('returns the first existing candidate', () => {
    // __dirname always exists as 'tests', so finding 'tests' relative to repo root should work
    const repoRoot = resolve(__dirname, '..');
    const result = findBundledDir(repoRoot, 'tests');
    expect(result).toBe(resolve(repoRoot, 'tests'));
  });

  it('returns null when no candidate exists', () => {
    const result = findBundledDir('/tmp', 'nonexistent-dir-xyz-12345');
    expect(result).toBeNull();
  });
});
