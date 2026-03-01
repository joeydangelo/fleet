import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseReviewOutput,
  REVIEW_DONE_MARKER,
  verdictFilePath,
  readVerdictFile,
} from '../src/lib/reviewer.js';

describe('parseReviewOutput (legacy pane-based parsing)', () => {
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

describe('verdictFilePath', () => {
  it('returns path under .paw/run with sanitized branch name', () => {
    const result = verdictFilePath('/repo', 'feature/api-auth');
    expect(result).toBe(resolve('/repo', '.paw', 'run', 'review-verdict-feature-api-auth.json'));
  });

  it('sanitizes special characters in branch name', () => {
    const result = verdictFilePath('/repo', 'my_branch@v2');
    expect(result).toContain('review-verdict-my-branch-v2.json');
  });
});

describe('readVerdictFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `paw-test-verdict-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', () => {
    expect(readVerdictFile(resolve(tmpDir, 'missing.json'))).toBeNull();
  });

  it('parses PASS verdict from JSON file', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, JSON.stringify({ verdict: 'PASS', findings: 'All good' }));
    const result = readVerdictFile(path);
    expect(result).toEqual({ verdict: 'pass', findings: 'All good' });
  });

  it('parses FAIL verdict from JSON file', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, JSON.stringify({ verdict: 'FAIL', findings: 'Bug in auth.ts' }));
    const result = readVerdictFile(path);
    expect(result).toEqual({ verdict: 'fail', findings: 'Bug in auth.ts' });
  });

  it('treats unknown verdict as fail', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, JSON.stringify({ verdict: 'MAYBE', findings: 'unsure' }));
    const result = readVerdictFile(path);
    expect(result!.verdict).toBe('fail');
  });

  it('returns null for malformed JSON', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, 'not json at all');
    expect(readVerdictFile(path)).toBeNull();
  });

  it('handles missing fields gracefully', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, JSON.stringify({}));
    const result = readVerdictFile(path);
    expect(result).toEqual({ verdict: 'fail', findings: '' });
  });
});

describe('REVIEW_DONE_MARKER', () => {
  it('is the expected constant', () => {
    expect(REVIEW_DONE_MARKER).toBe('--- PAW_REVIEW_COMPLETE ---');
  });
});
