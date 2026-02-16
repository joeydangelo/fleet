import { describe, it, expect } from 'vitest';
import type { JournalEntry } from '../src/lib/journal.js';
import type { TaskState } from '../src/lib/sync.js';
import {
  diffJournal,
  diffStatuses,
  diffCommitCounts,
  isAllDone,
  assignColor,
} from '../src/commands/watch.js';

describe('diffJournal', () => {
  it('returns entries after lastSeenTs', () => {
    const entries: JournalEntry[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'old' },
      { ts: '2026-02-14T10:01:00.000Z', from: 'api', type: 'broadcast', msg: 'new' },
      { ts: '2026-02-14T10:02:00.000Z', from: 'auth', type: 'ask', to: 'api', msg: 'newer' },
    ];

    const result = diffJournal(entries, '2026-02-14T10:00:00.000Z');
    expect(result.newEntries).toHaveLength(2);
    expect(result.newEntries[0]!.msg).toBe('new');
    expect(result.newEntries[1]!.msg).toBe('newer');
    expect(result.lastSeenTs).toBe('2026-02-14T10:02:00.000Z');
  });

  it('returns all entries when lastSeenTs is undefined', () => {
    const entries: JournalEntry[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'first' },
      { ts: '2026-02-14T10:01:00.000Z', from: 'api', type: 'broadcast', msg: 'second' },
    ];

    const result = diffJournal(entries, undefined);
    expect(result.newEntries).toHaveLength(2);
    expect(result.lastSeenTs).toBe('2026-02-14T10:01:00.000Z');
  });

  it('returns empty when no new entries', () => {
    const entries: JournalEntry[] = [
      { ts: '2026-02-14T10:00:00.000Z', from: 'auth', type: 'broadcast', msg: 'old' },
    ];

    const result = diffJournal(entries, '2026-02-14T10:01:00.000Z');
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBe('2026-02-14T10:01:00.000Z');
  });

  it('preserves lastSeenTs when journal is empty', () => {
    const result = diffJournal([], '2026-02-14T10:00:00.000Z');
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBe('2026-02-14T10:00:00.000Z');
  });

  it('returns undefined lastSeenTs when journal is empty and no previous ts', () => {
    const result = diffJournal([], undefined);
    expect(result.newEntries).toHaveLength(0);
    expect(result.lastSeenTs).toBeUndefined();
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

describe('isAllDone', () => {
  it('returns true when all tasks are done', () => {
    const tasks: Record<string, TaskState> = {
      auth: { status: 'done' },
      api: { status: 'done' },
    };
    expect(isAllDone(tasks)).toBe(true);
  });

  it('returns false when some tasks are not done', () => {
    const tasks: Record<string, TaskState> = {
      auth: { status: 'done' },
      api: { status: 'in_progress' },
    };
    expect(isAllDone(tasks)).toBe(false);
  });

  it('returns false for empty tasks', () => {
    expect(isAllDone({})).toBe(false);
  });
});

describe('assignColor', () => {
  it('assigns consistent colors based on task index', () => {
    const color0 = assignColor(0);
    const color1 = assignColor(1);

    // Colors should be functions (picocolors formatters)
    expect(typeof color0).toBe('function');
    expect(typeof color1).toBe('function');

    // Same index should give same color
    expect(assignColor(0)).toBe(assignColor(0));
  });

  it('wraps around when more tasks than colors', () => {
    // Should not throw even with high indices
    expect(typeof assignColor(100)).toBe('function');
  });
});
