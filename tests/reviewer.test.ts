import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { verdictFilePath, readVerdictFile } from '../src/lib/reviewer.js';

describe('verdictFilePath', () => {
  it('returns path under .fleet/run with sanitized branch name', () => {
    const result = verdictFilePath('/repo', 'feature/api-auth');
    expect(result).toBe(resolve('/repo', '.fleet', 'run', 'review-verdict-feature-api-auth.json'));
  });

  it('sanitizes special characters in branch name', () => {
    const result = verdictFilePath('/repo', 'my_branch@v2');
    expect(result).toContain('review-verdict-my-branch-v2.json');
  });
});

describe('readVerdictFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = resolve(tmpdir(), `fleet-test-verdict-${Date.now()}`);
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
    writeFileSync(
      path,
      JSON.stringify({
        verdict: 'PASS',
        strengths: 'Clean code',
        issues: '',
        suggestions: 'Consider caching',
      }),
    );
    const result = readVerdictFile(path);
    expect(result).toEqual({
      verdict: 'pass',
      strengths: 'Clean code',
      issues: '',
      suggestions: 'Consider caching',
    });
  });

  it('parses FAIL verdict from JSON file', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(
      path,
      JSON.stringify({ verdict: 'FAIL', strengths: '', issues: 'Bug in auth.ts' }),
    );
    const result = readVerdictFile(path);
    expect(result).toEqual({ verdict: 'fail', strengths: '', issues: 'Bug in auth.ts' });
  });

  it('treats unknown verdict as fail', () => {
    const path = resolve(tmpDir, 'verdict.json');
    writeFileSync(path, JSON.stringify({ verdict: 'MAYBE', strengths: '', issues: 'unsure' }));
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
    expect(result).toEqual({ verdict: 'fail', strengths: '', issues: '' });
  });
});
