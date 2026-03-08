import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncState } from '../src/lib/sync.js';
import type { ReviewResult } from '../src/lib/reviewer.js';

// Mock lib modules before importing review
vi.mock('../src/lib/git.js', () => ({
  getRepoRoot: vi.fn(() => '/fake/repo'),
  getCurrentBranch: vi.fn(() => 'feature/x-auth'),
}));

vi.mock('../src/lib/session.js', () => ({
  detectTaskName: vi.fn(() => 'auth'),
}));

vi.mock('../src/lib/sync.js', () => ({
  readSyncState: vi.fn(),
  writeSyncState: vi.fn(),
  writeSyncFile: vi.fn(),
  submitForReview: (state: SyncState, taskName: string) => ({
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: {
        ...state.tasks[taskName],
        status: 'in_review',
        reviewCycle: (state.tasks[taskName]?.reviewCycle ?? 0) + 1,
      },
    },
  }),
  completeTask: (state: SyncState, taskName: string) => ({
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: { ...state.tasks[taskName], status: 'done', doneAt: new Date().toISOString() },
    },
  }),
  reopenTask: (state: SyncState, taskName: string) => ({
    ...state,
    tasks: {
      ...state.tasks,
      [taskName]: { ...state.tasks[taskName], status: 'in_progress' },
    },
  }),
}));

vi.mock('../src/lib/tmux.js', () => ({
  createTmuxService: vi.fn(() => ({})),
}));

vi.mock('../src/lib/reviewer.js', () => ({
  reviewTask: vi.fn(),
}));

import { readSyncState, writeSyncState, writeSyncFile } from '../src/lib/sync.js';
import { createTmuxService } from '../src/lib/tmux.js';
import { reviewTask } from '../src/lib/reviewer.js';
import { runReview } from '../src/commands/review.js';

const mockReadSyncState = vi.mocked(readSyncState);
const mockWriteSyncState = vi.mocked(writeSyncState);
const mockCreateTmuxService = vi.mocked(createTmuxService);
const mockReviewTask = vi.mocked(reviewTask);

function baseSyncState(overrides?: Partial<SyncState>): SyncState {
  return {
    session: 'test',
    config: '/fake/config',
    target: 'feature/x',
    tasks: {
      auth: { status: 'in_progress', claimed: '2026-03-01T00:00:00Z' },
    },
    ...overrides,
  };
}

function passResult(): ReviewResult {
  return { verdict: 'pass', strengths: 'Clean code', issues: '' };
}

function failResult(): ReviewResult {
  return {
    verdict: 'fail',
    strengths: '',
    issues: 'CRITICAL/security src/auth.ts:12 -- SQL injection',
  };
}

function skipResult(): ReviewResult {
  return { verdict: 'skip', strengths: '', issues: 'Review timed out — skipping review.' };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runReview', () => {
  it('auto-completes when cycle exceeds max retries', async () => {
    const state = baseSyncState();
    state.tasks['auth']!.reviewCycle = 2; // REVIEW_MAX_RETRIES is 2
    mockReadSyncState.mockReturnValue(state);

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const written = mockWriteSyncState.mock.calls[0]![0];
    expect(written.tasks['auth']?.status).toBe('done');
    expect(mockReviewTask).not.toHaveBeenCalled();
  });

  it('auto-completes when tmux is unavailable', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockCreateTmuxService.mockImplementation(() => {
      throw new Error('tmux not found');
    });

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    // Should have written twice: once for submitForReview, once for completeTask
    expect(mockWriteSyncState).toHaveBeenCalledTimes(2);
    const lastWrite = mockWriteSyncState.mock.calls[1]![0];
    expect(lastWrite.tasks['auth']?.status).toBe('done');
  });

  it('marks done and exits 0 on PASS', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockReviewTask.mockResolvedValue(passResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('PASS'))).toBe(true);
  });

  it('marks done and exits 0 on SKIP', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockReviewTask.mockResolvedValue(skipResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('SKIP'))).toBe(true);
  });

  it('reopens task and exits 1 on FAIL with findings on stdout', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockReviewTask.mockResolvedValue(failResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(1);
    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('FAIL'))).toBe(true);
    expect(logs.some((l) => typeof l === 'string' && l.includes('SQL injection'))).toBe(true);
  });

  it('persists findings to sync branch as single review file', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockReviewTask.mockResolvedValue(passResult());
    const mockWriteSyncFile = vi.mocked(writeSyncFile);

    await runReview();

    // Last writeSyncFile call is the post-verdict relay with appended findings
    const lastCall = mockWriteSyncFile.mock.calls[mockWriteSyncFile.mock.calls.length - 1]!;
    const [path, content] = lastCall;
    expect(path).toBe('review/feature-x-auth.md');
    expect(content).toContain('## Review — Cycle 1');
    expect(content).toContain('PASS');
  });

  it('increments reviewCycle via submitForReview', async () => {
    const state = baseSyncState();
    mockReadSyncState.mockReturnValue(state);
    mockReviewTask.mockResolvedValue(passResult());

    await runReview();

    // First write is submitForReview (sets in_review + increments cycle)
    const submitWrite = mockWriteSyncState.mock.calls[0]![0];
    expect(submitWrite.tasks['auth']?.status).toBe('in_review');
    expect(submitWrite.tasks['auth']?.reviewCycle).toBe(1);
  });
});
