import { describe, it, expect } from 'vitest';
import { parseReviewOutput, REVIEW_DONE_MARKER } from '../src/lib/reviewer.js';

describe('parseReviewOutput', () => {
  it('returns null when done marker is absent', () => {
    expect(parseReviewOutput('some random output\nno marker here')).toBeNull();
  });

  it('parses PASS verdict', () => {
    const output = `Loading review-pr shortcut...
PASS
All looks good, no issues found.
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('pass');
    expect(result!.findings).toContain('All looks good');
  });

  it('parses FAIL verdict', () => {
    const output = `Loading review-pr shortcut...
FAIL
Missing error handling in auth.ts line 42.
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('fail');
    expect(result!.findings).toContain('Missing error handling');
  });

  it('handles PASS with trailing text on same line', () => {
    const output = `PASS - all checks passed
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result!.verdict).toBe('pass');
  });

  it('handles FAIL with trailing text on same line', () => {
    const output = `FAIL - 3 issues found
Details here.
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result!.verdict).toBe('fail');
  });

  it('defaults to fail when no PASS/FAIL line is found', () => {
    const output = `Some review output without a clear verdict
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result!.verdict).toBe('fail');
    expect(result!.findings).toContain('Some review output');
  });

  it('handles case-insensitive verdict with leading whitespace', () => {
    const output = `  pass
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result!.verdict).toBe('pass');
  });

  it('ignores content after the done marker', () => {
    const output = `PASS
Clean code.
${REVIEW_DONE_MARKER}
This should be ignored.`;

    const result = parseReviewOutput(output);
    expect(result!.findings).not.toContain('ignored');
  });

  it('returns null for empty string', () => {
    expect(parseReviewOutput('')).toBeNull();
  });
});

describe('REVIEW_DONE_MARKER', () => {
  it('is the expected constant', () => {
    expect(REVIEW_DONE_MARKER).toBe('--- PAW_REVIEW_COMPLETE ---');
  });
});
