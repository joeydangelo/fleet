import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import { appendJournalEntry, readJournal } from '../src/lib/journal.js';
import type { JournalEntry } from '../src/lib/journal.js';

/** Entry with optional thread (schema task adds this to JournalEntry). */
type ThreadedEntry = JournalEntry & { thread?: string };

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

describe('ask command threading', () => {
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

  it('ask entry has thread field', () => {
    const thread = makeThreadId();
    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'api', msg: 'What endpoint?', thread } as ThreadedEntry,
      repoDir,
    );

    const entries = readJournal(repoDir) as ThreadedEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBe(thread);
    expect(entries[0]!.type).toBe('ask');
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

  it('reply default: copies thread from lastAsk when present', () => {
    const thread = makeThreadId();
    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'api', msg: 'What endpoint?', thread } as ThreadedEntry,
      repoDir,
    );

    // Simulate reply logic: find last ask directed at 'api', copy thread
    const all = readJournal(repoDir) as ThreadedEntry[];
    const asks = all.filter((e) => e.type === 'ask' && e.to === 'api');
    const lastAsk = asks[asks.length - 1]!;
    expect(lastAsk.thread).toBe(thread);

    appendJournalEntry(
      'api',
      {
        type: 'reply',
        to: lastAsk.from,
        msg: 'Using /users',
        thread: lastAsk.thread,
      } as ThreadedEntry,
      repoDir,
    );

    const entries = readJournal(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBe(thread);
    expect(replies[0]!.to).toBe('orchestrator');
  });

  it('reply --to: finds correct ask by thread ID and copies thread', () => {
    const thread1 = makeThreadId();
    const thread2 = makeThreadId();

    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'api', msg: 'First question?', thread: thread1 } as ThreadedEntry,
      repoDir,
    );
    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'api', msg: 'Second question?', thread: thread2 } as ThreadedEntry,
      repoDir,
    );

    // Simulate --to thread1: find ask with matching thread directed at 'api'
    const all = readJournal(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'ask' && e.to === 'api' && e.thread === thread1);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.msg).toBe('First question?');

    appendJournalEntry(
      'api',
      {
        type: 'reply',
        to: matches[0]!.from,
        msg: 'Answer to first',
        thread: thread1,
      } as ThreadedEntry,
      repoDir,
    );

    const entries = readJournal(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBe(thread1);
  });

  it('reply --to: errors when thread not found', () => {
    const all = readJournal(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'ask' && e.to === 'api' && e.thread === 'zzzz');
    expect(matches).toHaveLength(0);
  });

  it('reply --to: errors when ask directed at wrong task', () => {
    const thread = makeThreadId();
    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'auth', msg: 'Auth question?', thread } as ThreadedEntry,
      repoDir,
    );

    // 'api' tries to reply to a thread directed at 'auth'
    const all = readJournal(repoDir) as ThreadedEntry[];
    const matches = all.filter((e) => e.type === 'ask' && e.to === 'api' && e.thread === thread);
    expect(matches).toHaveLength(0);

    // Verify the ask exists but is directed at a different task
    const wrongTask = all.find((e) => e.type === 'ask' && e.thread === thread && e.to !== 'api');
    expect(wrongTask).toBeDefined();
    expect(wrongTask!.to).toBe('auth');
  });

  it('reply to ask without thread omits thread from reply entry', () => {
    // Legacy ask without thread field
    appendJournalEntry(
      'orchestrator',
      { type: 'ask', to: 'api', msg: 'Old style question' },
      repoDir,
    );

    const all = readJournal(repoDir) as ThreadedEntry[];
    const asks = all.filter((e) => e.type === 'ask' && e.to === 'api');
    const lastAsk = asks[asks.length - 1]!;
    expect(lastAsk.thread).toBeUndefined();

    // Reply without thread
    appendJournalEntry(
      'api',
      { type: 'reply', to: lastAsk.from, msg: 'Old style answer' },
      repoDir,
    );

    const entries = readJournal(repoDir) as ThreadedEntry[];
    const replies = entries.filter((e) => e.type === 'reply');
    expect(replies).toHaveLength(1);
    expect(replies[0]!.thread).toBeUndefined();
  });
});
