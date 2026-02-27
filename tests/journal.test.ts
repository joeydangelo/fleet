import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  initSyncState,
  writeSyncState,
  writeSyncFile,
  initSyncWorktree,
  removeSyncWorktree,
} from '../src/lib/sync.js';
import {
  appendJournalEntry,
  readJournal,
  readJournalForTask,
  generateThreadId,
} from '../src/lib/journal.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('appendJournalEntry / readJournal', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('round-trips a broadcast entry', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Changed auth interface' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe('auth');
    expect(entries[0]!.type).toBe('broadcast');
    expect(entries[0]!.msg).toBe('Changed auth interface');
    expect(entries[0]!.ts).toBeTruthy();
    expect(entries[0]!.to).toBeUndefined();
  });

  it('round-trips a directed ask entry', () => {
    appendJournalEntry('api', { type: 'ask', to: 'auth', msg: 'What token type?' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe('api');
    expect(entries[0]!.type).toBe('ask');
    expect(entries[0]!.to).toBe('auth');
    expect(entries[0]!.msg).toBe('What token type?');
  });

  it('round-trips a reply entry', () => {
    appendJournalEntry('auth', { type: 'reply', to: 'api', msg: 'Union type' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('reply');
    expect(entries[0]!.to).toBe('api');
  });

  it('appends multiple entries to the same agent file', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'First change' }, repoDir);
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Second change' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.msg).toBe('First change');
    expect(entries[1]!.msg).toBe('Second change');
  });

  it('merges entries from multiple agents chronologically', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Auth change' }, repoDir);
    appendJournalEntry('api', { type: 'broadcast', msg: 'API change' }, repoDir);
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Auth update' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(3);
    // Should be sorted chronologically
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.ts >= entries[i - 1]!.ts).toBe(true);
    }
  });

  it('breaks ties deterministically by task name when timestamps match', () => {
    const ts = '2026-01-15T12:00:00.000Z';
    // Write both entries to the same file with zebra FIRST to defeat stable-sort
    // file-read ordering. Without a tiebreaker, zebra stays before alpha.
    const lines = [
      JSON.stringify({ ts, from: 'zebra', type: 'broadcast', msg: 'Z first?' }),
      JSON.stringify({ ts, from: 'alpha', type: 'broadcast', msg: 'A first?' }),
    ].join('\n');
    writeSyncFile('journal/mixed.jsonl', lines, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(2);
    // With deterministic sort, alpha should come before zebra at same timestamp
    expect(entries[0]!.from).toBe('alpha');
    expect(entries[1]!.from).toBe('zebra');
  });

  it('returns empty array when no journal entries exist', () => {
    const entries = readJournal(repoDir);
    expect(entries).toEqual([]);
  });
});

describe('generateThreadId', () => {
  it('returns a 4-character string', () => {
    const id = generateThreadId();
    expect(id).toHaveLength(4);
  });

  it('contains only lowercase alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateThreadId();
      expect(id).toMatch(/^[a-z0-9]{4}$/);
    }
  });

  it('generates distinct values across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(generateThreadId());
    }
    // With 36^4 = ~1.7M possibilities, 20 calls should all be unique
    expect(ids.size).toBe(20);
  });
});

describe('JournalEntry thread field', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('round-trips a journal entry with thread', () => {
    const threadId = generateThreadId();
    appendJournalEntry(
      'api',
      { type: 'ask', to: 'auth', msg: 'What type?', thread: threadId },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBe(threadId);
  });

  it('parses old entries without thread field cleanly', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'No thread here' }, repoDir);

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBeUndefined();
    expect(entries[0]!.msg).toBe('No thread here');
  });
});

describe('readJournalForTask', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth', 'api', 'dashboard'], 'paw.yaml');
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns broadcasts and messages directed at the task', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Changed interface' }, repoDir);
    appendJournalEntry('api', { type: 'ask', to: 'auth', msg: 'What type?' }, repoDir);
    appendJournalEntry('dashboard', { type: 'ask', to: 'api', msg: 'Endpoint ready?' }, repoDir);

    // auth should see: the broadcast (it's own but all broadcasts are shown),
    // and the ask directed at it
    const forAuth = readJournalForTask('auth', repoDir);
    const directed = forAuth.filter((e) => e.to === 'auth');
    expect(directed).toHaveLength(1);
    expect(directed[0]!.from).toBe('api');

    // api should see the message directed at it
    const forApi = readJournalForTask('api', repoDir);
    const directedToApi = forApi.filter((e) => e.to === 'api');
    expect(directedToApi).toHaveLength(1);
    expect(directedToApi[0]!.from).toBe('dashboard');
  });

  it('filters by since timestamp', () => {
    appendJournalEntry('auth', { type: 'broadcast', msg: 'Old message' }, repoDir);
    appendJournalEntry('api', { type: 'broadcast', msg: 'New message' }, repoDir);

    const allEntries = readJournal(repoDir);
    expect(allEntries).toHaveLength(2);

    // Use a timestamp far in the past -- both entries should be included
    const ancient = '2020-01-01T00:00:00.000Z';
    const afterAncient = readJournalForTask('dashboard', repoDir, ancient);
    expect(afterAncient).toHaveLength(2);

    // Use a timestamp far in the future -- no entries should be included
    const future = '2099-01-01T00:00:00.000Z';
    const afterFuture = readJournalForTask('dashboard', repoDir, future);
    expect(afterFuture).toHaveLength(0);

    // Use the first entry's timestamp -- should exclude it
    const since = allEntries[0]!.ts;
    const afterFirst = readJournalForTask('dashboard', repoDir, since);
    // The old entry (at or before `since`) is excluded
    const msgs = afterFirst.map((e) => e.msg);
    expect(msgs).not.toContain('Old message');
  });
});
