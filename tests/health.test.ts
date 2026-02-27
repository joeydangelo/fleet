import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveHealthState,
  computeEscalationLevel,
  readHeartbeat,
  writeHeartbeat,
  readHealthSnapshot,
  writeHealthSnapshot,
  writeNudge,
  readNudge,
  clearNudge,
  readInboxCursor,
  writeInboxCursor,
  saveTriageOutput,
} from '../src/lib/health.js';
import type { HealthSnapshot } from '../src/lib/health.js';

const STALL = 300; // 5 minutes
const ZOMBIE = 600; // 10 minutes

function makeOpts(overrides: Partial<Parameters<typeof resolveHealthState>[0]> = {}) {
  return {
    taskDone: false,
    tmuxAlive: true,
    lastActivity: null as string | null,
    now: new Date('2026-01-01T00:00:30.000Z'),
    stallThreshold: STALL,
    zombieThreshold: ZOMBIE,
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

  it('returns zombie when no lastActivity (launch heartbeat missing)', () => {
    expect(resolveHealthState(makeOpts())).toBe('zombie');
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
          now: new Date('2026-01-01T00:06:00.000Z'), // 6 min elapsed (between 5 and 10)
        }),
      ),
    ).toBe('stalled');
  });

  it('returns zombie when heartbeat is past zombie threshold', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:11:00.000Z'), // 11 min elapsed (past 10)
        }),
      ),
    ).toBe('zombie');
  });

  it('returns stalled at exact stall boundary (< not <=)', () => {
    // At exactly 300s, elapsed === threshold, so should be stalled
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:05:00.000Z'), // exactly 5 min
        }),
      ),
    ).toBe('stalled');

    // At 299s, should still be working
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:04:59.000Z'),
        }),
      ),
    ).toBe('working');
  });

  it('returns zombie at exact zombie boundary (< not <=)', () => {
    // At exactly 600s, elapsed === threshold, so should be zombie
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:10:00.000Z'), // exactly 10 min
        }),
      ),
    ).toBe('zombie');

    // At 599s, should still be stalled
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:09:59.000Z'),
        }),
      ),
    ).toBe('stalled');
  });

  it('returns working with launch heartbeat (lastActivity from spawn)', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T00:00:00.000Z',
          now: new Date('2026-01-01T00:00:30.000Z'),
        }),
      ),
    ).toBe('working');
  });
});

describe('computeEscalationLevel', () => {
  const NUDGE_INTERVAL = 90; // seconds
  const MAX_LEVEL = 3;
  const stalled = '2026-01-01T00:00:00.000Z';

  it('returns 0 before first interval elapses', () => {
    const now = new Date('2026-01-01T00:01:00.000Z'); // 60s < 90s
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, MAX_LEVEL)).toBe(0);
  });

  it('returns 1 after one interval', () => {
    const now = new Date('2026-01-01T00:01:30.000Z'); // 90s
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, MAX_LEVEL)).toBe(1);
  });

  it('returns 2 after two intervals', () => {
    const now = new Date('2026-01-01T00:03:00.000Z'); // 180s
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, MAX_LEVEL)).toBe(2);
  });

  it('returns 3 after three intervals', () => {
    const now = new Date('2026-01-01T00:04:30.000Z'); // 270s
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, MAX_LEVEL)).toBe(3);
  });

  it('caps at max level', () => {
    const now = new Date('2026-01-01T01:00:00.000Z'); // 3600s >> 270s
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, MAX_LEVEL)).toBe(3);
  });

  it('advances level only forward (floor-based)', () => {
    // At 89s → level 0, at 90s → level 1 (exact boundary)
    const just_before = new Date('2026-01-01T00:01:29.999Z');
    const at_boundary = new Date('2026-01-01T00:01:30.000Z');
    expect(computeEscalationLevel(stalled, just_before, NUDGE_INTERVAL, MAX_LEVEL)).toBe(0);
    expect(computeEscalationLevel(stalled, at_boundary, NUDGE_INTERVAL, MAX_LEVEL)).toBe(1);
  });

  it('respects custom nudge interval', () => {
    const now = new Date('2026-01-01T00:01:00.000Z'); // 60s
    expect(computeEscalationLevel(stalled, now, 60, MAX_LEVEL)).toBe(1);
    expect(computeEscalationLevel(stalled, now, 120, MAX_LEVEL)).toBe(0);
  });

  it('respects custom max level', () => {
    const now = new Date('2026-01-01T00:04:30.000Z'); // 270s → would be 3 with default
    expect(computeEscalationLevel(stalled, now, NUDGE_INTERVAL, 2)).toBe(2);
  });
});

// --- I/O functions: all transient files go under .paw/run/ ---

import { makeTempDir } from './helpers/temp.js';

describe('heartbeat I/O writes to .paw/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeHeartbeat creates file under .paw/run/heartbeats/', () => {
    writeHeartbeat(repoRoot, 'auth');
    const filePath = resolve(repoRoot, '.paw', 'run', 'heartbeats', 'auth');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8').trim();
    expect(new Date(content).toISOString()).toBe(content); // valid ISO timestamp
  });

  it('readHeartbeat reads from .paw/run/heartbeats/', () => {
    writeHeartbeat(repoRoot, 'api');
    const ts = readHeartbeat(repoRoot, 'api');
    expect(ts).toBeTruthy();
    expect(new Date(ts!).getTime()).not.toBeNaN();
  });

  it('readHeartbeat returns null when no heartbeat exists', () => {
    expect(readHeartbeat(repoRoot, 'missing')).toBeNull();
  });
});

describe('health snapshot I/O writes to .paw/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeHealthSnapshot creates .paw/run/health.json', () => {
    const snapshot: HealthSnapshot = {
      timestamp: '2026-01-01T00:00:00.000Z',
      agents: {},
    };
    writeHealthSnapshot(repoRoot, snapshot);
    const filePath = resolve(repoRoot, '.paw', 'run', 'health.json');
    expect(existsSync(filePath)).toBe(true);
  });

  it('readHealthSnapshot round-trips through .paw/run/', () => {
    const snapshot: HealthSnapshot = {
      timestamp: '2026-01-01T00:00:00.000Z',
      agents: {
        auth: {
          taskName: 'auth',
          state: 'working',
          lastActivity: '2026-01-01T00:00:00.000Z',
          stalledSince: null,
          escalationLevel: 0,
        },
      },
    };
    writeHealthSnapshot(repoRoot, snapshot);
    expect(readHealthSnapshot(repoRoot)).toEqual(snapshot);
  });

  it('readHealthSnapshot returns null when file is missing', () => {
    expect(readHealthSnapshot(repoRoot)).toBeNull();
  });
});

describe('nudge I/O writes to .paw/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeNudge creates file under .paw/run/nudges/', () => {
    writeNudge(repoRoot, 'auth', 'You seem stuck.');
    const filePath = resolve(repoRoot, '.paw', 'run', 'nudges', 'auth.md');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('You seem stuck.');
  });

  it('readNudge reads from .paw/run/nudges/', () => {
    writeNudge(repoRoot, 'api', 'Wake up!');
    expect(readNudge(repoRoot, 'api')).toBe('Wake up!');
  });

  it('clearNudge removes the file', () => {
    writeNudge(repoRoot, 'auth', 'msg');
    clearNudge(repoRoot, 'auth');
    expect(readNudge(repoRoot, 'auth')).toBeNull();
  });
});

describe('inbox cursor I/O writes to .paw/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeInboxCursor creates file under .paw/run/', () => {
    writeInboxCursor(repoRoot, 'auth', '2026-01-01T00:00:00.000Z');
    const filePath = resolve(repoRoot, '.paw', 'run', '.inbox-cursor-auth');
    expect(existsSync(filePath)).toBe(true);
  });

  it('readInboxCursor round-trips', () => {
    writeInboxCursor(repoRoot, 'api', '2026-02-15T12:30:00.000Z');
    expect(readInboxCursor(repoRoot, 'api')).toBe('2026-02-15T12:30:00.000Z');
  });

  it('readInboxCursor returns null when missing', () => {
    expect(readInboxCursor(repoRoot, 'nope')).toBeNull();
  });
});

describe('triage I/O writes to .paw/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('saveTriageOutput creates file under .paw/run/triage/', () => {
    saveTriageOutput(repoRoot, 'auth', 'terminal output', 'extend');
    const filePath = resolve(repoRoot, '.paw', 'run', 'triage', 'auth.txt');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('extend');
    expect(content).toContain('terminal output');
  });
});
