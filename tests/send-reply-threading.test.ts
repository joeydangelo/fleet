import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import {
  appendMessage,
  readMessages,
  generateThreadId,
  getUnansweredMessages,
  replyToMessage,
} from '../src/lib/messages.js';

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

    const reply = replyToMessage('api', 'orchestrator', 'Using /users', repoDir);

    expect(reply).not.toBeNull();
    expect(reply!.thread).toBe(thread);
    expect(reply!.to).toBe('orchestrator');
    expect(reply!.type).toBe('reply');
    expect(reply!.msg).toBe('Using /users');
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

    // Use production function to find remaining unanswered
    const unanswered = getUnansweredMessages('api', 'orchestrator', repoDir);

    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]!.thread).toBe(thread1);
    expect(unanswered[0]!.msg).toBe('First?');
  });

  it('reports no unanswered when all messages are replied to', () => {
    const thread = generateThreadId();
    appendMessage('orchestrator', { type: 'send', to: 'api', msg: 'Question?', thread }, repoDir);
    appendMessage('api', { type: 'reply', to: 'orchestrator', msg: 'Answer', thread }, repoDir);

    const unanswered = getUnansweredMessages('api', 'orchestrator', repoDir);
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

    const fromOrch = getUnansweredMessages('api', 'orchestrator', repoDir);
    const fromAuth = getUnansweredMessages('api', 'auth', repoDir);

    expect(fromOrch).toHaveLength(1);
    expect(fromOrch[0]!.msg).toBe('From orch');
    expect(fromAuth).toHaveLength(1);
    expect(fromAuth[0]!.msg).toBe('From auth');
  });
});
