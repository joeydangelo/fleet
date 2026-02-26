import { describe, it, expect } from 'vitest';
import { resolveHealthState, shouldNudge } from '../src/lib/health.js';
import type { AgentHealth } from '../src/lib/health.js';

const STALL = 180; // 3 minutes
const ZOMBIE = 480; // 8 minutes
const BOOT = 60; // 1 minute

function makeOpts(overrides: Partial<Parameters<typeof resolveHealthState>[0]> = {}) {
  return {
    taskDone: false,
    tmuxAlive: true,
    lastActivity: null as string | null,
    launchTime: '2026-01-01T00:00:00.000Z',
    now: new Date('2026-01-01T00:00:30.000Z'), // 30s after launch
    stallThreshold: STALL,
    zombieThreshold: ZOMBIE,
    bootGrace: BOOT,
    ...overrides,
  };
}

describe('resolveHealthState', () => {
  it('returns completed when task is done', () => {
    expect(resolveHealthState(makeOpts({ taskDone: true }))).toBe('completed');
  });

  it('returns completed even if tmux is dead (done takes priority)', () => {
    expect(resolveHealthState(makeOpts({ taskDone: true, tmuxAlive: false }))).toBe('completed');
  });

  it('returns zombie when tmux is dead and task is not done', () => {
    expect(resolveHealthState(makeOpts({ tmuxAlive: false }))).toBe('zombie');
  });

  it('returns zombie when tmux is dead even with recent heartbeat', () => {
    expect(
      resolveHealthState(
        makeOpts({
          tmuxAlive: false,
          lastActivity: '2026-01-01T00:00:29.000Z',
        }),
      ),
    ).toBe('zombie');
  });

  it('returns booting when no heartbeat and within boot grace', () => {
    expect(resolveHealthState(makeOpts())).toBe('booting');
  });

  it('returns zombie when no heartbeat and past boot grace', () => {
    expect(
      resolveHealthState(
        makeOpts({
          now: new Date('2026-01-01T00:02:00.000Z'), // 2min after launch
        }),
      ),
    ).toBe('zombie');
  });

  it('returns working when heartbeat is within stall threshold', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:25.000Z',
          now: new Date('2026-01-01T00:00:30.000Z'),
        }),
      ),
    ).toBe('working');
  });

  it('returns stalled when heartbeat is between stall and zombie thresholds', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:04:00.000Z'), // 4 min elapsed
        }),
      ),
    ).toBe('stalled');
  });

  it('returns zombie when heartbeat is past zombie threshold', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:09:00.000Z'), // 9 min elapsed
        }),
      ),
    ).toBe('zombie');
  });

  it('returns working at exact stall boundary (< not <=)', () => {
    // At exactly 180s, elapsed === threshold, so should be stalled
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:03:00.000Z'),
        }),
      ),
    ).toBe('stalled');

    // At 179s, should still be working
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:02:59.000Z'),
        }),
      ),
    ).toBe('working');
  });
});

describe('shouldNudge', () => {
  function makeHealth(overrides: Partial<AgentHealth> = {}): AgentHealth {
    return {
      taskName: 'test',
      state: 'stalled',
      lastActivity: '2026-01-01T00:00:00.000Z',
      stalledSince: '2026-01-01T00:03:00.000Z',
      nudgeCount: 0,
      lastNudge: null,
      ...overrides,
    };
  }

  it('returns true for first nudge on a stalled agent', () => {
    expect(shouldNudge(makeHealth(), new Date('2026-01-01T00:04:00.000Z'))).toBe(true);
  });

  it('returns false when agent is not stalled', () => {
    expect(
      shouldNudge(makeHealth({ state: 'working' }), new Date('2026-01-01T00:04:00.000Z')),
    ).toBe(false);
  });

  it('returns false when max nudges reached', () => {
    expect(
      shouldNudge(makeHealth({ nudgeCount: 3 }), new Date('2026-01-01T00:04:00.000Z'), 90, 3),
    ).toBe(false);
  });

  it('returns false when last nudge was too recent', () => {
    expect(
      shouldNudge(
        makeHealth({
          nudgeCount: 1,
          lastNudge: '2026-01-01T00:04:00.000Z',
        }),
        new Date('2026-01-01T00:04:30.000Z'), // only 30s later
        90,
      ),
    ).toBe(false);
  });

  it('returns true when enough time has passed since last nudge', () => {
    expect(
      shouldNudge(
        makeHealth({
          nudgeCount: 1,
          lastNudge: '2026-01-01T00:04:00.000Z',
        }),
        new Date('2026-01-01T00:05:31.000Z'), // 91s later
        90,
      ),
    ).toBe(true);
  });
});
