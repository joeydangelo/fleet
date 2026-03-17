import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { ReviewResult } from '../src/lib/reviewer.js';
import { verdictFilePath } from '../src/lib/reviewer.js';
import type { TmuxServiceApi } from '../src/lib/tmux.js';
import { createFixtureRepo, type FixtureRepo } from './helpers/fixture-repo.js';
import { getCurrentBranch } from '../src/lib/git.js';
import { reviewFilePath } from '../src/lib/sync.js';

// Mock only external boundary: tmux (external process)
vi.mock('../src/lib/tmux.js', () => ({
  createTmuxService: vi.fn(),
  waitForAgentReady: vi.fn().mockResolvedValue(true),
  killDetachedSession: vi.fn(),
  isAgentPromptReady: vi.fn().mockReturnValue(true),
}));

import {
  createTmuxService,
  waitForAgentReady,
  killDetachedSession,
  isAgentPromptReady,
} from '../src/lib/tmux.js';
import { runReview } from '../src/commands/review.js';

const mockCreateTmuxService = vi.mocked(createTmuxService);
const mockWaitForAgentReady = vi.mocked(waitForAgentReady);
const mockKillDetachedSession = vi.mocked(killDetachedSession);
const mockIsAgentPromptReady = vi.mocked(isAgentPromptReady);

let fixture: FixtureRepo;
let originalCwd: string;

/**
 * Build a mock TmuxServiceApi that simulates a reviewer tmux session.
 * When verdictToWrite is set, the mock writes the verdict file during
 * the 2nd sendKeys call (the review prompt), so reviewTask finds it
 * on its first poll iteration.
 */
function createMockTmuxApi(opts?: {
  verdictToWrite?: ReviewResult;
  repoRoot?: string;
  branch?: string;
  sessionDies?: boolean;
}): TmuxServiceApi {
  let sessionAlive = true;
  let sendKeysCount = 0;

  return {
    sessionExists: vi.fn(() => {
      if (opts?.sessionDies) return false;
      return sessionAlive;
    }),
    createSession: vi.fn(),
    killSession: vi.fn(() => {
      sessionAlive = false;
    }),
    sendKeys: vi.fn((_target: string, _keys: string) => {
      sendKeysCount++;
      // Write verdict file when review prompt is sent (2nd sendKeys call),
      // after reviewTask has created the .fleet/run/ directory and cleaned
      // up any old verdict file.
      if (sendKeysCount === 2 && opts?.verdictToWrite && opts?.repoRoot && opts?.branch) {
        const vPath = verdictFilePath(opts.repoRoot, opts.branch);
        writeFileSync(vPath, JSON.stringify(opts.verdictToWrite));
      }
    }),
    capturePaneContent: vi.fn(() => null),
    listSessions: vi.fn(() => []),
    listPanesDetailed: vi.fn(() => []),
    capturePane: vi.fn(() => ''),
    setPaneTitle: vi.fn(),
    setPaneRole: vi.fn(),
    setPaneProject: vi.fn(),
    getCurrentSessionName: vi.fn(() => ''),
    getPaneCurrentCommand: vi.fn(() => ''),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  originalCwd = process.cwd();
  // Re-establish tmux mock implementations (restoreAllMocks resets them)
  mockWaitForAgentReady.mockResolvedValue(true);
  mockKillDetachedSession.mockImplementation(() => {});
  mockIsAgentPromptReady.mockReturnValue(true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (fixture) {
    fixture.cleanup();
  }
});

/** Fake time (ms) to advance past reviewTask's sleep+poll cycle.
 *  Derived from: 2s initial + 5s poll + 10s timeout + 3s margin = 20s, rounded to 25s. */
const REVIEW_SETTLE_MS = 25_000;

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
    // No review artifacts created — reviewTask was never reached
    const branch = getCurrentBranch(fixture.repoRoot);
    const reviewContent = fixture.readSyncFile(reviewFilePath(branch));
    expect(reviewContent).toBeNull();
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
    vi.useFakeTimers();

    const branch = getCurrentBranch(fixture.repoRoot);
    const mockTmux = createMockTmuxApi({
      verdictToWrite: { verdict: 'pass', strengths: 'Clean code', issues: '' },
      repoRoot: fixture.repoRoot,
      branch,
    });
    mockCreateTmuxService.mockReturnValue(mockTmux as ReturnType<typeof createTmuxService>);

    const promise = runReview();
    await vi.advanceTimersByTimeAsync(REVIEW_SETTLE_MS);
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');

    const reviewContent = fixture.readSyncFile(reviewFilePath(branch));
    expect(reviewContent).toContain('Review — Cycle 1');
    expect(reviewContent).toContain('PASS');
  });

  it('reopens task and exits 1 on FAIL verdict', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    vi.useFakeTimers();

    const branch = getCurrentBranch(fixture.repoRoot);
    const mockTmux = createMockTmuxApi({
      verdictToWrite: {
        verdict: 'fail',
        strengths: '',
        issues: 'CRITICAL/security src/auth.ts:12 -- SQL injection',
      },
      repoRoot: fixture.repoRoot,
      branch,
    });
    mockCreateTmuxService.mockReturnValue(mockTmux as ReturnType<typeof createTmuxService>);

    const promise = runReview();
    await vi.advanceTimersByTimeAsync(REVIEW_SETTLE_MS);
    const exitCode = await promise;

    expect(exitCode).toBe(1);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('in_progress');

    const logs = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.includes('SQL injection'))).toBe(true);
  });

  it('marks done and exits 0 on SKIP verdict', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    vi.useFakeTimers();

    // Session dies immediately — reviewTask returns skip verdict
    const mockTmux = createMockTmuxApi({ sessionDies: true });
    mockCreateTmuxService.mockReturnValue(mockTmux as ReturnType<typeof createTmuxService>);

    const promise = runReview();
    await vi.advanceTimersByTimeAsync(REVIEW_SETTLE_MS);
    const exitCode = await promise;

    expect(exitCode).toBe(0);
    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.status).toBe('done');
  });

  it('increments reviewCycle after PASS', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    vi.useFakeTimers();

    const branch = getCurrentBranch(fixture.repoRoot);
    const mockTmux = createMockTmuxApi({
      verdictToWrite: { verdict: 'pass', strengths: 'Good', issues: '' },
      repoRoot: fixture.repoRoot,
      branch,
    });
    mockCreateTmuxService.mockReturnValue(mockTmux as ReturnType<typeof createTmuxService>);

    const promise = runReview();
    await vi.advanceTimersByTimeAsync(REVIEW_SETTLE_MS);
    await promise;

    const state = fixture.readSyncState()!;
    expect(state.tasks['auth']?.reviewCycle).toBe(1);
  });

  it('submits for review before calling reviewTask', async () => {
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);
    vi.useFakeTimers();

    const branch = getCurrentBranch(fixture.repoRoot);
    const mockTmux = createMockTmuxApi({
      verdictToWrite: { verdict: 'pass', strengths: 'Good', issues: '' },
      repoRoot: fixture.repoRoot,
      branch,
    });

    // Capture sync state when reviewTask first touches tmux (createSession)
    let statusAtReviewTime: string | undefined;
    mockTmux.createSession = vi.fn((_name: string, _cwd: string) => {
      const stateAtReviewTime = fixture.readSyncState()!;
      statusAtReviewTime = stateAtReviewTime.tasks['auth']?.status;
    });

    mockCreateTmuxService.mockReturnValue(mockTmux as ReturnType<typeof createTmuxService>);

    const promise = runReview();
    await vi.advanceTimersByTimeAsync(REVIEW_SETTLE_MS);
    await promise;

    // When reviewTask started (creating tmux session), task was already in_review
    expect(statusAtReviewTime).toBe('in_review');
  });
});
