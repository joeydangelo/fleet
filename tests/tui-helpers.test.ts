import { describe, it, expect } from 'vitest';
import { agentBadge, taskDisplayStatus, statusIcon } from '../src/lib/tui-helpers.js';
import type { TaskState, MergeEntry } from '../src/lib/sync.js';

describe('agentBadge', () => {
  it('maps known agents to short codes', () => {
    expect(agentBadge('claude')).toBe('[cc]');
    expect(agentBadge('codex')).toBe('[cx]');
    expect(agentBadge('opencode')).toBe('[oc]');
    expect(agentBadge('gemini')).toBe('[gm]');
  });

  it('returns [??] for unknown agent', () => {
    expect(agentBadge('unknown')).toBe('[??]');
  });
});

describe('taskDisplayStatus', () => {
  it('returns pending when no task state exists', () => {
    expect(taskDisplayStatus(undefined, undefined)).toBe('pending');
  });

  it('returns pending for pending task state', () => {
    const task: TaskState = { status: 'pending' };
    expect(taskDisplayStatus(task, undefined)).toBe('pending');
  });

  it('returns in_progress for in_progress task state', () => {
    const task: TaskState = { status: 'in_progress' };
    expect(taskDisplayStatus(task, undefined)).toBe('in_progress');
  });

  it('returns done for done task state', () => {
    const task: TaskState = { status: 'done' };
    expect(taskDisplayStatus(task, undefined)).toBe('done');
  });

  it('returns conflict when merge entry has conflict status', () => {
    const task: TaskState = { status: 'done' };
    const merge: MergeEntry = { status: 'conflict' };
    expect(taskDisplayStatus(task, merge)).toBe('conflict');
  });

  it('does not override non-conflict merge statuses', () => {
    const task: TaskState = { status: 'done' };
    const merge: MergeEntry = { status: 'merged' };
    expect(taskDisplayStatus(task, merge)).toBe('done');
  });
});

describe('statusIcon', () => {
  it('returns spinning icon for in_progress', () => {
    const { icon, color } = statusIcon('in_progress');
    expect(icon).toBe('✻');
    expect(color).toBe('cyan');
  });

  it('returns checkmark for done', () => {
    const { icon, color } = statusIcon('done');
    expect(icon).toBe('✓');
    expect(color).toBe('green');
  });

  it('returns error icon for conflict', () => {
    const { icon, color } = statusIcon('conflict');
    expect(icon).toBe('✗');
    expect(color).toBe('red');
  });

  it('returns dim circle for pending', () => {
    const { icon } = statusIcon('pending');
    expect(icon).toBe('◌');
  });
});
