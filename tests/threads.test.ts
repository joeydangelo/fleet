import { describe, it, expect } from 'vitest';
import { computeThreads } from '../src/commands/threads.js';
import type { JournalEntry } from '../src/lib/journal.js';

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
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(open).toHaveLength(1);
    expect(open[0]!.ask.msg).toBe('Ready?');
    expect(resolved).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
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

  it('broadcasts are collected separately from threads', () => {
    const entries = [
      entry({ type: 'broadcast', from: 'auth', msg: 'Changed AuthConfig interface' }),
      entry({ type: 'broadcast', from: 'api', msg: 'Added 3 new endpoints' }),
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
    ];
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]!.from).toBe('auth');
    expect(broadcasts[1]!.from).toBe('api');
    expect(open).toHaveLength(1);
    expect(resolved).toHaveLength(0);
  });

  it('entries without thread field are not shown as threads', () => {
    const entries = [
      entry({ type: 'ask', from: 'orchestrator', to: 'api', msg: 'No thread field' }),
      entry({ type: 'broadcast', from: 'api', msg: 'Some broadcast' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'No thread reply' }),
    ];
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.msg).toBe('Some broadcast');
  });

  it('no entries returns empty', () => {
    const { open, resolved, broadcasts } = computeThreads([]);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });
});
