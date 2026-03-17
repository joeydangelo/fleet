import { describe, it, expect } from 'vitest';
import {
  formatTime,
  relativeTime,
  formatMessage,
  computeDuration,
  mergeBadge,
} from './dashboard.js';
import type { Message } from '../lib/messages.js';
import type { TaskState } from '../lib/sync.js';

describe('formatTime', () => {
  it('formats a date as HH:MM:SS AM/PM', () => {
    // Use a fixed UTC date and verify it produces a time string with AM/PM
    const date = new Date('2026-03-17T14:30:45Z');
    const result = formatTime(date);
    // Should contain AM or PM
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)/);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-03-17T12:00:00Z');

  it('returns seconds for < 60s', () => {
    const ts = new Date(now.getTime() - 30_000).toISOString();
    expect(relativeTime(ts, now)).toBe('30s ago');
  });

  it('returns minutes for < 60m', () => {
    const ts = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(relativeTime(ts, now)).toBe('5m ago');
  });

  it('returns hours for >= 60m', () => {
    const ts = new Date(now.getTime() - 2 * 3600_000).toISOString();
    expect(relativeTime(ts, now)).toBe('2h ago');
  });

  it('returns 0s ago for future timestamps', () => {
    const ts = new Date(now.getTime() + 10_000).toISOString();
    expect(relativeTime(ts, now)).toBe('0s ago');
  });
});

describe('formatMessage', () => {
  const now = new Date('2026-03-17T12:00:00Z');

  it('formats broadcast messages', () => {
    const msg: Message = {
      ts: new Date(now.getTime() - 60_000).toISOString(),
      from: 'schema',
      type: 'broadcast',
      msg: 'Migration done',
    };
    const result = formatMessage(msg, now, 80);
    expect(result).toContain('schema:');
    expect(result).toContain('Migration done');
    expect(result).toContain('1m ago');
  });

  it('formats send messages with from -> to', () => {
    const msg: Message = {
      ts: new Date(now.getTime() - 120_000).toISOString(),
      from: 'worker',
      type: 'send',
      to: 'orchestrator',
      msg: 'Blocked',
    };
    const result = formatMessage(msg, now, 80);
    expect(result).toContain('worker -> orchestrator:');
    expect(result).toContain('Blocked');
  });

  it('formats nudge messages with Orchestrator prefix', () => {
    const msg: Message = {
      ts: new Date(now.getTime() - 45_000).toISOString(),
      from: 'orchestrator',
      type: 'nudge',
      to: 'worker',
      msg: 'Wake up',
    };
    const result = formatMessage(msg, now, 80);
    expect(result).toContain('Orchestrator -> worker:');
  });

  it('truncates long messages with ...', () => {
    const msg: Message = {
      ts: now.toISOString(),
      from: 'agent',
      type: 'broadcast',
      msg: 'A'.repeat(200),
    };
    const result = formatMessage(msg, now, 50);
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(55); // small padding tolerance
  });
});

describe('computeDuration', () => {
  const now = new Date('2026-03-17T12:05:30Z');

  it('returns empty string when no claimed timestamp', () => {
    const task: TaskState = { status: 'pending' };
    expect(computeDuration(task, now)).toBe('');
  });

  it('computes elapsed from claimed to now for active tasks', () => {
    const task: TaskState = {
      status: 'in_progress',
      claimed: '2026-03-17T12:00:00Z',
    };
    const result = computeDuration(task, now);
    expect(result).toBe('5m 30s');
  });

  it('computes elapsed from claimed to doneAt for finished tasks', () => {
    const task: TaskState = {
      status: 'done',
      claimed: '2026-03-17T12:00:00Z',
      doneAt: '2026-03-17T12:03:10Z',
    };
    const result = computeDuration(task, now);
    expect(result).toBe('3m 10s');
  });
});

describe('mergeBadge', () => {
  it('returns green for merged', () => {
    expect(mergeBadge('merged')).toEqual({ label: 'merged', color: 'green' });
  });

  it('returns red for conflict', () => {
    expect(mergeBadge('conflict')).toEqual({ label: 'conflict', color: 'red' });
  });

  it('returns gray for skipped', () => {
    expect(mergeBadge('skipped')).toEqual({ label: 'skipped', color: 'gray' });
  });

  it('returns yellow for pending', () => {
    expect(mergeBadge('pending')).toEqual({ label: 'pending', color: 'yellow' });
  });
});
