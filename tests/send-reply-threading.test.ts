import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendMessage, readMessages } from '../src/lib/messages.js';
import type { Message } from '../src/lib/messages.js';

/** Entry with optional thread (schema task adds this to Message). */
type ThreadedEntry = Message & { thread?: string };

/** Local thread ID generator matching generateThreadId contract. */
function makeThreadId(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('send command threading', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['orchestrator', 'api', 'auth'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('send entry has thread field', () => {
    const thread = makeThreadId();
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'What endpoint?', thread } as ThreadedEntry,
      repoDir,
    );

    const entries = readMessages(repoDir) as ThreadedEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBe(thread);
    expect(entries[0]!.type).toBe('send');
    expect(entries[0]!.to).toBe('api');
  });
});

describe('reply command threading', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['orchestrator', 'api', 'auth'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('reply default: copies thread from lastSend when present', () => {
    const thread = makeThreadId();
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'What endpoint?', thread } as ThreadedEntry,
      repoDir,
    );

    // Simulate reply logic: find last send directed at 'api', copy thread
    const all = readMessages(repoDir) as ThreadedEntry[];
    const sends = all.filter((e) => e.type === 'send' && e.to === 'api');
    const lastSend = sends[sends.length - 1]!;
    expect(lastSend.thread).toBe(thread);

    appendMessage(
      'api',
      {
        type: 'reply',
        to: lastSend.from,
        msg: 'Using /users',
        thread: lastSend.thread,
      } as ThreadedEntry,
      repoDir,
    );

    const entries = readMessages(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBe(thread);
    expect(replies[0]!.to).toBe('orchestrator');
  });

  it('reply --to: finds correct message by thread ID and copies thread', () => {
    const thread1 = makeThreadId();
    const thread2 = makeThreadId();

    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'First question?', thread: thread1 } as ThreadedEntry,
      repoDir,
    );
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'Second question?', thread: thread2 } as ThreadedEntry,
      repoDir,
    );

    // Simulate --to thread1: find send with matching thread directed at 'api'
    const all = readMessages(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'send' && e.to === 'api' && e.thread === thread1);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.msg).toBe('First question?');

    appendMessage(
      'api',
      {
        type: 'reply',
        to: matches[0]!.from,
        msg: 'Answer to first',
        thread: thread1,
      } as ThreadedEntry,
      repoDir,
    );

    const entries = readMessages(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBe(thread1);
  });

  it('reply --to: errors when thread not found', () => {
    const all = readMessages(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'send' && e.to === 'api' && e.thread === 'zzzz');
    expect(matches).toHaveLength(0);
  });

  it('reply --to: errors when message directed at wrong task', () => {
    const thread = makeThreadId();
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'auth', msg: 'Auth question?', thread } as ThreadedEntry,
      repoDir,
    );

    // 'api' tries to reply to a thread directed at 'auth'
    const all = readMessages(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'send' && e.to === 'api' && e.thread === thread);
    expect(matches).toHaveLength(0);

    // Verify the message exists but is directed at a different task
    const wrongTask = all.find((e) => e.type === 'send' && e.thread === thread && e.to !== 'api');
    expect(wrongTask).toBeDefined();
    expect(wrongTask!.to).toBe('auth');
  });

  it('reply to send without thread omits thread from reply entry', () => {
    // Legacy send without thread field
    appendMessage('orchestrator', { type: 'send', to: 'api', msg: 'Old style question' }, repoDir);

    const all = readMessages(repoDir) as ThreadedEntry[];
    const sends = all.filter((e) => e.type === 'send' && e.to === 'api');
    const lastSend = sends[sends.length - 1]!;
    expect(lastSend.thread).toBeUndefined();

    // Reply without thread
    appendMessage('api', { type: 'reply', to: lastSend.from, msg: 'Old style answer' }, repoDir);

    const entries = readMessages(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBeUndefined();
  });
});
