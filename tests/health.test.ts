import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync as fsWriteFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveHealthState,
  computeEscalationLevel,
  parseTriageVerdict,
  readHeartbeat,
  writeHeartbeat,
  readHealthSnapshot,
  writeHealthSnapshot,
  readInboxCursor,
  writeInboxCursor,
  saveTriageOutput,
} from '../src/lib/health.js';
import type { HealthSnapshot } from '../src/lib/health.js';
import {
  STALL_THRESHOLD_S as STALL,
  ZOMBIE_THRESHOLD_S as ZOMBIE,
  NUDGE_INTERVAL_S as NUDGE_INTERVAL,
  MAX_ESCALATION_LEVEL as MAX_LEVEL,
} from '../src/lib/constants.js';

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

  // Finding 23: boundary tests for lastActivity

  it('returns zombie when lastActivity is empty string (falsy)', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '',
        }),
      ),
    ).toBe('zombie');
  });

  it('returns zombie when lastActivity is an invalid date string (NaN elapsed)', () => {
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: 'not-a-date',
        }),
      ),
    ).toBe('zombie');
  });

  it('returns working when lastActivity is in the future (negative elapsed)', () => {
    // Future-dated lastActivity means elapsed < 0, which is < stallThreshold → working
    expect(
      resolveHealthState(
        makeOpts({
          lastActivity: '2026-01-01T01:00:00.000Z',
          now: new Date('2026-01-01T00:00:30.000Z'),
        }),
      ),
    ).toBe('working');
  });
});

describe('computeEscalationLevel', () => {
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

// --- I/O functions: all transient files go under .fleet/run/ ---

import { makeTempDir } from './helpers/temp.js';

describe('heartbeat I/O writes to .fleet/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeHeartbeat creates file under .fleet/run/heartbeats/', () => {
    writeHeartbeat(repoRoot, 'auth');
    const filePath = resolve(repoRoot, '.fleet', 'run', 'heartbeats', 'auth');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8').trim();
    expect(new Date(content).toISOString()).toBe(content); // valid ISO timestamp
  });

  it('readHeartbeat returns null when no heartbeat exists', () => {
    expect(readHeartbeat(repoRoot, 'missing')).toBeNull();
  });
});

describe('health snapshot I/O writes to .fleet/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeHealthSnapshot round-trips snapshot to .fleet/run/health.json', () => {
    const snapshot: HealthSnapshot = {
      timestamp: '2026-01-01T00:00:00.000Z',
      agents: {},
    };
    writeHealthSnapshot(repoRoot, snapshot);
    const result = readHealthSnapshot(repoRoot);
    expect(result).toEqual(snapshot);
  });

  it('readHealthSnapshot returns null when file is missing', () => {
    expect(readHealthSnapshot(repoRoot)).toBeNull();
  });
});

describe('inbox cursor I/O writes to .fleet/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writeInboxCursor round-trips cursor value to .fleet/run/', () => {
    writeInboxCursor(repoRoot, 'auth', '2026-01-01T00:00:00.000Z');
    expect(readInboxCursor(repoRoot, 'auth')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('readInboxCursor returns null when missing', () => {
    expect(readInboxCursor(repoRoot, 'nope')).toBeNull();
  });
});

describe('parseTriageVerdict', () => {
  it('returns terminate for "TERMINATE"', () => {
    expect(parseTriageVerdict('TERMINATE')).toBe('terminate');
  });

  it('returns retry for "RETRY"', () => {
    expect(parseTriageVerdict('RETRY')).toBe('retry');
  });

  it('returns extend for "EXTEND"', () => {
    expect(parseTriageVerdict('EXTEND')).toBe('extend');
  });

  it('returns retry when both TERMINATE and RETRY present (precedence)', () => {
    expect(parseTriageVerdict('do not TERMINATE, RETRY instead')).toBe('retry');
  });

  it('returns extend when both EXTEND and TERMINATE present', () => {
    expect(parseTriageVerdict('EXTEND, do not TERMINATE')).toBe('extend');
  });

  it('returns extend for empty string', () => {
    expect(parseTriageVerdict('')).toBe('extend');
  });

  it('returns extend for garbage input', () => {
    expect(parseTriageVerdict('I am not sure what to do')).toBe('extend');
  });

  it('is case-insensitive', () => {
    expect(parseTriageVerdict('retry')).toBe('retry');
    expect(parseTriageVerdict('Terminate')).toBe('terminate');
    expect(parseTriageVerdict('extend')).toBe('extend');
  });
});

describe('readHeartbeat warns on non-ENOENT errors', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null for missing heartbeat (ENOENT)', () => {
    expect(readHeartbeat(repoRoot, 'missing-task')).toBeNull();
  });

  it('reads valid heartbeat content', () => {
    const dir = resolve(repoRoot, '.fleet', 'run', 'heartbeats');
    mkdirSync(dir, { recursive: true });
    fsWriteFileSync(resolve(dir, 'auth'), '2026-01-01T00:00:00.000Z');
    expect(readHeartbeat(repoRoot, 'auth')).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('readHealthSnapshot warns on non-ENOENT errors', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns null for missing health.json (ENOENT)', () => {
    expect(readHealthSnapshot(repoRoot)).toBeNull();
  });

  it('warns and returns null for corrupt JSON', () => {
    const dir = resolve(repoRoot, '.fleet', 'run');
    mkdirSync(dir, { recursive: true });
    fsWriteFileSync(resolve(dir, 'health.json'), '{corrupt');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readHealthSnapshot(repoRoot);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[fleet] readHealthSnapshot'));
    warnSpy.mockRestore();
  });

  it('warns and returns null for invalid schema', () => {
    const dir = resolve(repoRoot, '.fleet', 'run');
    mkdirSync(dir, { recursive: true });
    fsWriteFileSync(resolve(dir, 'health.json'), JSON.stringify({ wrong: 'shape' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readHealthSnapshot(repoRoot);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[fleet] readHealthSnapshot'));
    warnSpy.mockRestore();
  });
});

describe('triage I/O writes to .fleet/run/', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('saveTriageOutput creates file under .fleet/run/triage/', () => {
    saveTriageOutput(repoRoot, 'auth', 'terminal output', 'extend', '2026-01-01T00:00:00.000Z');
    const filePath = resolve(repoRoot, '.fleet', 'run', 'triage', 'auth.txt');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('extend');
    expect(content).toContain('terminal output');
  });
});
