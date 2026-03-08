import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendMessage, readMessages, generateThreadId } from '../src/lib/messages.js';

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
    const thread = generateThreadId();
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'What endpoint?', thread },
      repoDir,
    );

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBe(thread);
    expect(entries[0]!.type).toBe('send');
    expect(entries[0]!.to).toBe('api');
  });
});

describe('reply targets unanswered messages', () => {
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

  it('reply copies thread from the target send', () => {
    const thread = generateThreadId();
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'What endpoint?', thread },
      repoDir,
    );

    // Simulate reply logic: find unanswered send from orchestrator to api
    const all = readMessages(repoDir);
    const unanswered = all.filter(
      (e) => e.type === 'send' && e.from === 'orchestrator' && e.to === 'api',
    );
    const target = unanswered[0]!;

    appendMessage(
      'api',
      { type: 'reply', to: 'orchestrator', msg: 'Using /users', thread: target.thread },
      repoDir,
    );

    const entries = readMessages(repoDir);
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBe(thread);
    expect(replies[0]!.to).toBe('orchestrator');
  });

  it('second reply skips already-answered message and targets the next', () => {
    const thread1 = generateThreadId();
    const thread2 = generateThreadId();

    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'First?', thread: thread1 },
      repoDir,
    );
    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'Second?', thread: thread2 },
      repoDir,
    );

    // Reply to thread2 directly
    appendMessage(
      'api',
      { type: 'reply', to: 'orchestrator', msg: 'Answer to second', thread: thread2 },
      repoDir,
    );

    // Find remaining unanswered
    const all = readMessages(repoDir);
    const repliedThreads = new Set(
      all.filter((e) => e.type === 'reply' && e.from === 'api' && e.thread).map((e) => e.thread!),
    );
    const unanswered = all.filter(
      (e) =>
        e.type === 'send' &&
        e.from === 'orchestrator' &&
        e.to === 'api' &&
        (!e.thread || !repliedThreads.has(e.thread)),
    );

    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]!.thread).toBe(thread1);
    expect(unanswered[0]!.msg).toBe('First?');
  });

  it('reports no unanswered when all messages are replied to', () => {
    const thread = generateThreadId();
    appendMessage('orchestrator', { type: 'send', to: 'api', msg: 'Question?', thread }, repoDir);
    appendMessage('api', { type: 'reply', to: 'orchestrator', msg: 'Answer', thread }, repoDir);

    const all = readMessages(repoDir);
    const repliedThreads = new Set(
      all.filter((e) => e.type === 'reply' && e.from === 'api' && e.thread).map((e) => e.thread!),
    );
    const unanswered = all.filter(
      (e) =>
        e.type === 'send' &&
        e.from === 'orchestrator' &&
        e.to === 'api' &&
        (!e.thread || !repliedThreads.has(e.thread)),
    );

    expect(unanswered).toHaveLength(0);
  });

  it('only considers messages from the specified sender', () => {
    const thread1 = generateThreadId();
    const thread2 = generateThreadId();

    appendMessage(
      'orchestrator',
      { type: 'send', to: 'api', msg: 'From orch', thread: thread1 },
      repoDir,
    );
    appendMessage('auth', { type: 'send', to: 'api', msg: 'From auth', thread: thread2 }, repoDir);

    const all = readMessages(repoDir);
    const fromOrch = all.filter(
      (e) => e.type === 'send' && e.from === 'orchestrator' && e.to === 'api',
    );
    const fromAuth = all.filter((e) => e.type === 'send' && e.from === 'auth' && e.to === 'api');

    expect(fromOrch).toHaveLength(1);
    expect(fromOrch[0]!.msg).toBe('From orch');
    expect(fromAuth).toHaveLength(1);
    expect(fromAuth[0]!.msg).toBe('From auth');
  });
});
