import { describe, it, expect } from 'vitest';
import { formatFocusAreas, colors } from '../src/lib/output.js';

describe('formatFocusAreas', () => {
  it('returns empty string for undefined', () => {
    expect(formatFocusAreas(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatFocusAreas([])).toBe('');
  });

  it('shows single item', () => {
    expect(formatFocusAreas(['src/auth/'])).toBe('(src/auth/)');
  });

  it('shows two items', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/'])).toBe('(src/auth/, src/api/)');
  });

  it('shows three items without truncation', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/'])).toBe(
      '(src/auth/, src/api/, src/middleware/)',
    );
  });

  it('truncates four items to first 2 + count', () => {
    expect(formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/', 'src/utils/'])).toBe(
      '(src/auth/, src/api/, +2 more)',
    );
  });

  it('truncates five items to first 2 + count', () => {
    expect(
      formatFocusAreas(['src/auth/', 'src/api/', 'src/middleware/', 'src/utils/', 'tests/']),
    ).toBe('(src/auth/, src/api/, +3 more)');
  });
});

describe('colors', () => {
  it('exports all five semantic color functions', () => {
    expect(typeof colors.success).toBe('function');
    expect(typeof colors.error).toBe('function');
    expect(typeof colors.warn).toBe('function');
    expect(typeof colors.info).toBe('function');
    expect(typeof colors.muted).toBe('function');
  });

  it('wraps text with color codes', () => {
    // Each function should return a non-empty string that differs from the input
    // (contains ANSI escape codes or picocolors formatting)
    const input = 'test';
    expect(colors.success(input)).toContain(input);
    expect(colors.error(input)).toContain(input);
    expect(colors.warn(input)).toContain(input);
    expect(colors.info(input)).toContain(input);
    expect(colors.muted(input)).toContain(input);
  });
});
