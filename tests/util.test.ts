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

  it('handles negative ms input', () => {
    // Math.floor(-1 / 1000) = -1, -1 % 60 = -1 → produces "-1s"
    const result = formatElapsed(-1);
    expect(result).toBe('-1s');
  });

  it('distinguishes 999ms (rounds to 0s) from 1000ms (rounds to 1s)', () => {
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(1000)).toBe('1s');
  });

  it('formats large value 3661000ms as 61m 1s', () => {
    // 3661 seconds = 61 minutes, 1 second
    expect(formatElapsed(3_661_000)).toBe('61m 1s');
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
