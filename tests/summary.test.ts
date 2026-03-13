import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/git.js', () => ({
  getRepoRoot: vi.fn(() => '/fake/repo'),
  getCurrentBranch: vi.fn(() => 'feature/x-auth'),
}));

vi.mock('../src/lib/sync.js', () => ({
  readRequiredSyncState: vi.fn(() => ({
    session: 'test',
    target: 'main',
    tasks: { auth: { status: 'in_progress' } },
  })),
  requireWorktreeTask: vi.fn(() => 'auth'),
  reviewFilePath: vi.fn((branch: string) => `review/${branch.replace(/[^a-zA-Z0-9-]/g, '-')}.md`),
  readSyncFile: vi.fn(),
  writeSyncFile: vi.fn(),
}));

import { readSyncFile, writeSyncFile } from '../src/lib/sync.js';
import { runSummary } from '../src/commands/summary.js';

const mockReadSyncFile = vi.mocked(readSyncFile);
const mockWriteSyncFile = vi.mocked(writeSyncFile);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSummary', () => {
  describe('write mode (default)', () => {
    it('writes stdin content to sync branch review file', () => {
      const content = '## Summary\nTest summary content\n';

      const exitCode = runSummary({ content });

      expect(exitCode).toBe(0);
      expect(mockWriteSyncFile).toHaveBeenCalledWith(
        'review/feature-x-auth.md',
        content,
        '/fake/repo',
      );
    });

    it('fails with exit 1 when content is empty', () => {
      const exitCode = runSummary({ content: '' });

      expect(exitCode).toBe(1);
      expect(mockWriteSyncFile).not.toHaveBeenCalled();
    });

    it('prints confirmation with task name', () => {
      runSummary({ content: 'test content' });

      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('auth') && l.includes('summary written'))).toBe(true);
    });
  });

  describe('--show and --append together', () => {
    it('fails with exit 1 when both flags are set', () => {
      const exitCode = runSummary({ show: true, append: true, content: 'test' });

      expect(exitCode).toBe(1);
      expect(mockWriteSyncFile).not.toHaveBeenCalled();
      expect(mockReadSyncFile).not.toHaveBeenCalled();
    });
  });

  describe('--show mode', () => {
    it('reads and prints summary from sync branch', () => {
      mockReadSyncFile.mockReturnValue('## Summary\nExisting content\n');

      const exitCode = runSummary({ show: true });

      expect(exitCode).toBe(0);
      expect(mockReadSyncFile).toHaveBeenCalledWith('review/feature-x-auth.md', '/fake/repo');
      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('Existing content'))).toBe(true);
    });

    it('prints message when no summary exists yet', () => {
      mockReadSyncFile.mockReturnValue(null);

      const exitCode = runSummary({ show: true });

      expect(exitCode).toBe(0);
      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('No summary'))).toBe(true);
    });
  });

  describe('--append mode', () => {
    it('appends content to existing summary on sync branch', () => {
      mockReadSyncFile.mockReturnValue('## Summary\nOriginal\n');
      const appendContent = '\n## Fixed — Cycle 1\nFix notes\n';

      const exitCode = runSummary({ append: true, content: appendContent });

      expect(exitCode).toBe(0);
      expect(mockWriteSyncFile).toHaveBeenCalledWith(
        'review/feature-x-auth.md',
        '## Summary\nOriginal\n' + appendContent,
        '/fake/repo',
      );
    });

    it('writes content even when no existing summary (creates new)', () => {
      mockReadSyncFile.mockReturnValue(null);
      const content = '## Fixed — Cycle 1\nFix notes\n';

      const exitCode = runSummary({ append: true, content });

      expect(exitCode).toBe(0);
      expect(mockWriteSyncFile).toHaveBeenCalledWith(
        'review/feature-x-auth.md',
        content,
        '/fake/repo',
      );
    });

    it('fails with exit 1 when append content is empty', () => {
      const exitCode = runSummary({ append: true, content: '' });

      expect(exitCode).toBe(1);
      expect(mockWriteSyncFile).not.toHaveBeenCalled();
    });

    it('prints confirmation with updated message', () => {
      mockReadSyncFile.mockReturnValue('existing');

      runSummary({ append: true, content: 'new stuff' });

      const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('auth') && l.includes('summary updated'))).toBe(true);
    });
  });
});
