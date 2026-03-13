import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFixtureRepo } from './helpers/fixture-repo.js';
import { runSummary } from '../src/commands/summary.js';

let fixture: ReturnType<typeof createFixtureRepo>;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  fixture = createFixtureRepo({ taskName: 'auth' });
  process.chdir(fixture.repoRoot);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  fixture.cleanup();
});

describe('runSummary', () => {
  describe('write mode', () => {
    it('writes content to sync branch review file', () => {
      const content = '## Summary\nTest summary content\n';

      const exitCode = runSummary({ content });

      expect(exitCode).toBe(0);
      const branch = 'fix-test-theatre-rewrite-auth';
      const written = fixture.readSyncFile(`review/${branch}.md`);
      expect(written).toBe(content);
    });

    it('fails with exit 1 when content is empty', () => {
      const exitCode = runSummary({ content: '' });

      expect(exitCode).toBe(1);
      const branch = 'fix-test-theatre-rewrite-auth';
      const written = fixture.readSyncFile(`review/${branch}.md`);
      expect(written).toBeNull();
    });
  });

  describe('show mode', () => {
    it('reads and prints summary from sync branch', () => {
      const content = '## Summary\nExisting content\n';
      const branch = 'fix-test-theatre-rewrite-auth';
      // Write file directly to sync dir so show can read it
      mkdirSync(resolve(fixture.syncDir, 'review'), { recursive: true });
      writeFileSync(resolve(fixture.syncDir, `review/${branch}.md`), content);

      const exitCode = runSummary({ show: true });

      expect(exitCode).toBe(0);
      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('Existing content'))).toBe(true);
    });

    it('prints message when no summary exists', () => {
      const exitCode = runSummary({ show: true });

      expect(exitCode).toBe(0);
      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('No summary'))).toBe(true);
    });
  });

  describe('append mode', () => {
    it('appends content to existing summary', () => {
      const original = '## Summary\nOriginal\n';
      const appendContent = '\n## Fixed — Cycle 1\nFix notes\n';
      // Write initial file
      runSummary({ content: original });

      const exitCode = runSummary({ append: true, content: appendContent });

      expect(exitCode).toBe(0);
      const branch = 'fix-test-theatre-rewrite-auth';
      const result = fixture.readSyncFile(`review/${branch}.md`);
      expect(result).toBe(original + appendContent);
    });
  });

  describe('show + append conflict', () => {
    it('fails with exit 1 when both flags are set', () => {
      const exitCode = runSummary({ show: true, append: true });

      expect(exitCode).toBe(1);
    });
  });
});
