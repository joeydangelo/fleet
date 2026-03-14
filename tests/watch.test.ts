import { describe, it, expect } from 'vitest';
import type { Message } from '../src/lib/messages.js';
import type { TaskState } from '../src/lib/sync.js';
import { diffMessages, diffStatuses, diffCommitCounts } from '../src/commands/watch.js';

describe('diffMessages', () => {
  it('returns entries after lastSeenTs', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'old' },
      { ts: '2026-02-14T10:01:00.000Z', from: 'api', type: 'broadcast', msg: 'new' },
      { ts: '2026-02-14T10:02:00.000Z', from: 'auth', type: 'send', to: 'api', msg: 'newer' },
    ];

    const result = diffMessages(entries, '2026-02-14T10:00:00.000Z');
    expect(result.newEntries).toHaveLength(2);
    expect(result.newEntries[0]!.msg).toBe('new');
    expect(result.newEntries[1]!.msg).toBe('newer');
    expect(result.lastSeenTs).toBe('2026-02-14T10:02:00.000Z');
  });

  it('returns all entries when lastSeenTs is undefined', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'first' },
      { ts: '2026-02-14T10:01:00.000Z', from: 'api', type: 'broadcast', msg: 'second' },
    ];

    const result = diffMessages(entries, undefined);
    expect(result.newEntries).toHaveLength(2);
    expect(result.lastSeenTs).toBe('2026-02-14T10:01:00.000Z');
  });

  it('returns empty when no new entries', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'old' },
    ];

    const result = diffMessages(entries, '2026-02-14T10:01:00.000Z');
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBe('2026-02-14T10:01:00.000Z');
  });

  it('preserves lastSeenTs when messages is empty', () => {
    const result = diffMessages([], '2026-02-14T10:00:00.000Z');
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBe('2026-02-14T10:00:00.000Z');
  });

  it('returns undefined lastSeenTs when messages is empty and no previous ts', () => {
    const result = diffMessages([], undefined);
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBeUndefined();
  });

  // Finding 22: timestamp edge cases

  it('excludes entries with timestamp equal to lastSeenTs (strict >)', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'exact match' },
      { ts: '2026-02-14T10:00:01.000Z', from: 'api', type: 'broadcast', msg: 'after' },
    ];

    const result = diffMessages(entries, '2026-02-14T10:00:00.000Z');
    expect(result.newEntries).toHaveLength(1);
    expect(result.newEntries[0]!.msg).toBe('after');
  });

  it('handles duplicate timestamps — all entries with same ts included/excluded consistently', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'dup-1' },
      { ts: '2026-02-14T10:00:00.000Z', from: 'api', type: 'broadcast', msg: 'dup-2' },
      { ts: '2026-02-14T10:00:01.000Z', from: 'auth', type: 'broadcast', msg: 'later' },
    ];

    // When cursor is before duplicates, both should be included
    const result1 = diffMessages(entries, '2026-02-14T09:59:59.000Z');
    expect(result1.newEntries).toHaveLength(3);
    expect(result1.newEntries.filter((e) => e.msg.startsWith('dup-'))).toHaveLength(2);

    // When cursor equals the duplicate ts, both should be excluded
    const result2 = diffMessages(entries, '2026-02-14T10:00:00.000Z');
    expect(result2.newEntries).toHaveLength(1);
    expect(result2.newEntries[0]!.msg).toBe('later');
    // Neither dup-1 nor dup-2 should appear
    expect(result2.newEntries.some((e) => e.msg.startsWith('dup-'))).toBe(false);
  });

  it('handles out-of-order entries — filter is per-entry, not positional', () => {
    const entries: Message[] = [
      { ts: '2026-02-14T10:02:00.000Z', from: 'auth', type: 'broadcast', msg: 'late' },
      { ts: '2026-02-14T10:00:00.000Z', from: 'api', type: 'broadcast', msg: 'early' },
      { ts: '2026-02-14T10:01:00.000Z', from: 'auth', type: 'broadcast', msg: 'mid' },
    ];

    const result = diffMessages(entries, '2026-02-14T10:00:30.000Z');
    // 'early' is at 10:00:00 — excluded (not > cursor)
    // 'mid' is at 10:01:00 — included
    // 'late' is at 10:02:00 — included
    expect(result.newEntries).toHaveLength(2);
    expect(result.newEntries.map((e) => e.msg).sort()).toEqual(['late', 'mid']);
  });
});

describe('diffStatuses', () => {
  it('detects status transitions', () => {
    const prev: Record<string, TaskState['status']> = { auth: 'pending', api: 'pending' };
    const curr: Record<string, TaskState> = {
      auth: { status: 'in_progress', claimed: '2026-02-14T10:00:00.000Z' },
      api: { status: 'pending' },
    };

    const result = diffStatuses(prev, curr);
    expect(result.transitions).toEqual([{ task: 'auth', from: 'pending', to: 'in_progress' }]);
    expect(result.currentStatuses).toEqual({ auth: 'in_progress', api: 'pending' });
  });

  it('detects multiple transitions', () => {
    const prev: Record<string, TaskState['status']> = {
      auth: 'in_progress',
      api: 'pending',
    };
    const curr: Record<string, TaskState> = {
      auth: { status: 'done', doneAt: '2026-02-14T10:05:00.000Z' },
      api: { status: 'in_progress', claimed: '2026-02-14T10:03:00.000Z' },
    };

    const result = diffStatuses(prev, curr);
    expect(result.transitions).toHaveLength(2);
    expect(result.transitions).toContainEqual({
      task: 'auth',
      from: 'in_progress',
      to: 'done',
    });
    expect(result.transitions).toContainEqual({ task: 'api', from: 'pending', to: 'in_progress' });
  });

  it('returns empty transitions when nothing changed', () => {
    const prev: Record<string, TaskState['status']> = { auth: 'in_progress' };
    const curr: Record<string, TaskState> = {
      auth: { status: 'in_progress' },
    };

    const result = diffStatuses(prev, curr);
    expect(result.transitions).toHaveLength(0);
  });

  it('handles new tasks not in prev map', () => {
    const prev: Record<string, TaskState['status']> = {};
    const curr: Record<string, TaskState> = {
      auth: { status: 'pending' },
    };

    const result = diffStatuses(prev, curr);
    expect(result.transitions).toEqual([{ task: 'auth', from: undefined, to: 'pending' }]);
  });
});

describe('diffCommitCounts', () => {
  it('detects new commits', () => {
    const prev: Record<string, number> = { auth: 2, api: 1 };
    const curr: Record<string, number> = { auth: 5, api: 1 };

    const result = diffCommitCounts(prev, curr);
    expect(result.deltas).toEqual([{ task: 'auth', from: 2, to: 5 }]);
    expect(result.currentCounts).toEqual({ auth: 5, api: 1 });
  });

  it('returns empty deltas when unchanged', () => {
    const prev: Record<string, number> = { auth: 3 };
    const curr: Record<string, number> = { auth: 3 };

    const result = diffCommitCounts(prev, curr);
    expect(result.deltas).toHaveLength(0);
  });

  it('handles new task appearing', () => {
    const prev: Record<string, number> = {};
    const curr: Record<string, number> = { auth: 2 };

    const result = diffCommitCounts(prev, curr);
    expect(result.deltas).toEqual([{ task: 'auth', from: 0, to: 2 }]);
  });
});
