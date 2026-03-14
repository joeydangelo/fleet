import { describe, it, expect } from 'vitest';
import { computeThreads, formatMessage } from '../src/commands/inbox.js';
import type { Message } from '../src/lib/messages.js';

function entry(overrides: Partial<Message> & { thread?: string }): Message {
  return {
    ts: new Date().toISOString(),
    from: 'orchestrator',
    type: 'broadcast',
    msg: 'test',
    ...overrides,
  } as Message;
}

describe('computeThreads', () => {
  it('send with no reply is open', () => {
    const entries = [
      entry({ type: 'send', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
    ];
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(open).toHaveLength(1);
    expect(open[0]!.send.msg).toBe('Ready?');
    expect(resolved).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('send with matching reply thread is resolved', () => {
    const entries = [
      entry({ type: 'send', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'Yes', thread: 'abc123' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.send.msg).toBe('Ready?');
    expect(resolved[0]!.reply.msg).toBe('Yes');
  });

  it('--all scenario: includes both open and resolved', () => {
    const entries = [
      entry({ type: 'send', from: 'orchestrator', to: 'api', msg: 'Auth changed?', thread: 'th1' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'Yes', thread: 'th1' }),
      entry({ type: 'send', from: 'orchestrator', to: 'db', msg: 'Schema ready?', thread: 'th2' }),
    ];
    const { open, resolved } = computeThreads(entries);

    expect(open).toHaveLength(1);
    expect(open[0]!.send.to).toBe('db');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.send.to).toBe('api');
  });

  it('broadcasts are collected separately from threads', () => {
    const entries = [
      entry({ type: 'broadcast', from: 'auth', msg: 'Changed AuthConfig interface' }),
      entry({ type: 'broadcast', from: 'api', msg: 'Added 3 new endpoints' }),
      entry({ type: 'send', from: 'orchestrator', to: 'api', msg: 'Ready?', thread: 'abc123' }),
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
      entry({ type: 'send', from: 'orchestrator', to: 'api', msg: 'No thread field' }),
      entry({ type: 'broadcast', from: 'api', msg: 'Some broadcast' }),
      entry({ type: 'reply', from: 'api', to: 'orchestrator', msg: 'No thread reply' }),
    ];
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(open).toHaveLength(0);
    expect(resolved).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.msg).toBe('Some broadcast');
  });

  it('nudge entries are grouped with broadcasts', () => {
    const entries = [
      entry({ type: 'broadcast', from: 'auth', msg: 'Changed interface' }),
      entry({
        type: 'nudge',
        from: 'orchestrator',
        to: 'api',
        msg: 'Please finish auth integration',
      }),
      entry({ type: 'send', from: 'orchestrator', to: 'db', msg: 'Schema ready?', thread: 'th1' }),
    ];
    const { open, resolved, broadcasts } = computeThreads(entries);

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]!.type).toBe('broadcast');
    expect(broadcasts[1]!.type).toBe('nudge');
    expect(open).toHaveLength(1);
    expect(resolved).toHaveLength(0);
  });
});

describe('formatMessage', () => {
  it('formats nudge with warning prefix', () => {
    const nudge = entry({ type: 'nudge', from: 'orchestrator', msg: 'Finish task' });
    expect(formatMessage(nudge)).toBe('[paw] Warning: Finish task');
  });
});
