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

  it('ignores PASS/FAIL in analysis text before the real verdict', () => {
    const output = `Loading review-pr shortcut...
Reviewing diff for task branch...

The FAIL case is not handled properly in the error path.
I also note that PASS is mentioned in a comment but never tested.

After full review, the code looks correct:

PASS
All issues are minor and pre-existing, not introduced by this PR.
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('pass');
    expect(result!.findings).toContain('All issues are minor');
  });

  it('picks last FAIL when analysis text mentions PASS before real verdict', () => {
    const output = `The code currently returns PASS for all inputs.
This is wrong — validation is missing.

FAIL
Missing input validation in handler.ts.
${REVIEW_DONE_MARKER}`;

    const result = parseReviewOutput(output);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('fail');
    expect(result!.findings).toContain('Missing input validation');
  });
});

describe('REVIEW_DONE_MARKER', () => {
  it('is the expected constant', () => {
    expect(REVIEW_DONE_MARKER).toBe('--- PAW_REVIEW_COMPLETE ---');
  });
});
