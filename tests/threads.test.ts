import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { computeThreads } from '../src/commands/threads.js';
import type { JournalEntry } from '../src/lib/journal.js';
import { detectTaskName } from '../src/lib/session.js';

function entry(overrides: Partial<JournalEntry> & { thread?: string }): JournalEntry {
  return {
    ts: new Date().toISOString(),
    from: 'orchestrator',
    type: 'broadcast',
    msg: 'test',
    ...overrides,
  } as JournalEntry;
}

describe('computeThreads', () => {
  it('ask with no reply is open', () => {
    const entries = [
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(1);
    expect(open[0]!.ask.msg).toBe('Ready?');
    expect(resolved).toHaveLength(0);
  });

  it('ask with matching reply thread is resolved', () => {
    const entries = [
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'Yes', thread: 'abc123' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.ask.msg).toBe('Ready?');
    expect(resolved[0]!.reply.msg).toBe('Yes');
  });

  it('--all scenario: includes both open and resolved', () => {
    const entries = [
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'Auth changed?', thread: 'th1' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'Yes', thread: 'th1' }),
      entry({ type: 'ask', from: 'orchestrator', to: 'db', msg: 'Schema ready?', thread: 'th2' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(1);
    expect(open[0]!.ask.to).toBe('db');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.ask.to).toBe('api');
  });

  it('entries without thread field are not shown', () => {
    const entries = [
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'No thread field' }),
      entry({ type: 'broadcast', from: 'api', msg: 'Some broadcast' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'No thread reply' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(0);
  });

  it('no threads returns empty', () => {
    const { open, resolved } = computeThreads([]);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(0);
  });
});

describe('orchestrator identity fallback', () => {
  it('detectTaskName returns null outside worktree, falls back to orchestrator', () => {
    const dir = resolve(
      tmpdir(),
      `paw-threads-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });

    // No .paw/tasks/ directory exists
    const result = detectTaskName(dir);
    expect(result).toBeNull();

    // The fallback pattern: detectTaskName(cwd) ?? 'orchestrator'
    const identity = result ?? 'orchestrator';
    expect(identity).toBe('orchestrator');

    rmSync(dir, { recursive: true, force: true });
  });

  it('detectTaskName returns task name when .paw/tasks/ has one file', () => {
    const dir = resolve(
      tmpdir(),
      `paw-threads-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const tasksDir = resolve(dir, '.paw', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, 'myagent.md'), '# Task: myagent\n');

    const result = detectTaskName(dir);
    expect(result).toBe('myagent');

    rmSync(dir, { recursive: true, force: true });
  });
});
