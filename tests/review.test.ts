import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReviewResult } from '../src/lib/reviewer.js';
import { createFixtureRepo, type FixtureRepo } from './helpers/fixture-repo.js';
import { getCurrentBranch } from '../src/lib/git.js';
import { reviewFilePath } from '../src/lib/sync.js';

// Mock only external boundaries
vi.mock('../src/lib/tmux.js', () => ({
  createTmuxService: vi.fn(() => ({})),
}));

vi.mock('../src/lib/reviewer.js', () => ({
  reviewTask: vi.fn(),
}));

import { createTmuxService } from '../src/lib/tmux.js';
import { reviewTask } from '../src/lib/reviewer.js';
import { runReview } from '../src/commands/review.js';

const mockCreateTmuxService = vi.mocked(createTmuxService);
const mockReviewTask = vi.mocked(reviewTask);

let fixture: FixtureRepo;
let originalCwd: string;

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
  originalCwd = process.cwd();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  if (fixture) {
    fixture.cleanup();
  }
});

describe('runReview', () => {
  it('auto-completes when cycle exceeds max retries', async () => {
    fixture = createFixtureRepo({
      syncState: {
        tasks: {
          auth: { reviewCycle: 2 },
        },
      },
    });
    process.chdir(fixture.repoRoot);

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');
    expect(mockReviewTask).not.toHaveBeenCalled();
  });

  it('auto-completes when tmux is unavailable', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    mockCreateTmuxService.mockImplementation(() => {
      throw new Error('tmux not found');
    });

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');
  });

  it('marks done and exits 0 on PASS verdict', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    mockReviewTask.mockResolvedValue(passResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');

    // Verify review file was written with cycle and verdict
    const reviewContent = fixture.readSyncFile(reviewFilePath(getCurrentBranch()));
    expect(reviewContent).toContain('Review — Cycle 1');
    expect(reviewContent).toContain('PASS');
  });

  it('reopens task and exits 1 on FAIL verdict', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    mockReviewTask.mockResolvedValue(failResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(1);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('in_progress');

    // Verify issue text appears in console output
    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('SQL injection'))).toBe(true);
  });

  it('marks done and exits 0 on SKIP verdict', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    mockReviewTask.mockResolvedValue(skipResult());

    const exitCode = await runReview();

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');
  });

  it('increments reviewCycle after PASS', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    mockReviewTask.mockResolvedValue(passResult());

    await runReview();

    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('calls submitForReview before reviewTask (Finding 21)', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);

    // Track call order to verify submitForReview happens before reviewTask
    const callOrder: string[] = [];
    mockReviewTask.mockImplementation(() => {
      // At the point reviewTask is called, sync state should already be 'in_review'
      const stateAtReviewTime = fixture.readSyncState()!;
      callOrder.push(`reviewTask:status=${stateAtReviewTime.tasks['auth']?.status}`);
      return Promise.resolve(passResult());
    });

    await runReview();

    // TODO: when reviewTask is de-mocked (HIGH spec), this assertion
    // becomes naturally testable through real review artifacts.
    expect(mockReviewTask).toHaveBeenCalledTimes(1);
    expect(callOrder).toHaveLength(1);
    expect(callOrder[0]).toBe('reviewTask:status=in_review');
  });
});
