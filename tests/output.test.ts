import { describe, it, expect } from 'vitest';
import { formatFocusAreas, formatTaskStatus } from '../src/lib/output.js';

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

describe('formatTaskStatus', () => {
  it('maps in_review to "in review"', () => {
    expect(formatTaskStatus('in_review')).toBe('in review');
  });

  it('passes through other statuses unchanged', () => {
    expect(formatTaskStatus('done')).toBe('done');
    expect(formatTaskStatus('pending')).toBe('pending');
    expect(formatTaskStatus('in_progress')).toBe('in_progress');
  });
});
