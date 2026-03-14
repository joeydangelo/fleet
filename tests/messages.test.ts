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
  appendMessage,
  readMessages,
  readMessagesForTask,
  generateThreadId,
} from '../src/lib/messages.js';
import { makeTempDir } from './helpers/temp.js';

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('appendMessage / readMessages', () => {
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
    appendMessage('auth', { type: 'broadcast', msg: 'Changed auth interface' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe('auth');
    expect(entries[0]!.type).toBe('broadcast');
    expect(entries[0]!.msg).toBe('Changed auth interface');
    expect(entries[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entries[0]!.to).toBeUndefined();
  });

  it('round-trips a directed send entry', () => {
    appendMessage('api', { type: 'send', to: 'auth', msg: 'What token type?' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe('api');
    expect(entries[0]!.type).toBe('send');
    expect(entries[0]!.to).toBe('auth');
    expect(entries[0]!.msg).toBe('What token type?');
  });

  it('round-trips a reply entry', () => {
    appendMessage('auth', { type: 'reply', to: 'api', msg: 'Union type' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('reply');
    expect(entries[0]!.to).toBe('api');
  });

  it('appends multiple entries to the same agent file', () => {
    appendMessage('auth', { type: 'broadcast', msg: 'First change' }, repoDir);
    appendMessage('auth', { type: 'broadcast', msg: 'Second change' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.msg).toBe('First change');
    expect(entries[1]!.msg).toBe('Second change');
  });

  it('merges entries from multiple agents chronologically', () => {
    appendMessage('auth', { type: 'broadcast', msg: 'Auth change' }, repoDir);
    appendMessage('api', { type: 'broadcast', msg: 'API change' }, repoDir);
    appendMessage('auth', { type: 'broadcast', msg: 'Auth update' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(3);
    // Should be sorted chronologically
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.ts >= entries[i - 1]!.ts).toBe(true);
    }
  });

  // Sort edge case: manual JSONL to control timestamps — cannot use appendMessage
  // because it auto-generates timestamps, making identical-ts collisions untestable.
  it('breaks ties deterministically by task name when timestamps match', () => {
    const ts = '2026-01-15T12:00:00.000Z';
    // Write both entries to the same file with zebra FIRST to defeat stable-sort
    // file-read ordering. Without a tiebreaker, zebra stays before alpha.
    const lines = [
      JSON.stringify({ ts, from: 'zebra', type: 'broadcast', msg: 'Z first?' }),
      JSON.stringify({ ts, from: 'alpha', type: 'broadcast', msg: 'A first?' }),
    ].join('\n');
    writeSyncFile('inbox/mixed.jsonl', lines, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(2);
    // With deterministic sort, alpha should come before zebra at same timestamp
    expect(entries[0]!.from).toBe('alpha');
    expect(entries[1]!.from).toBe('zebra');
  });

  it('returns empty array when no messages exist', () => {
    const entries = readMessages(repoDir);
    expect(entries).toEqual([]);
  });

  it('round-trips a nudge entry', () => {
    appendMessage('orchestrator', { type: 'nudge', to: 'auth', msg: 'Finish auth task' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe('orchestrator');
    expect(entries[0]!.type).toBe('nudge');
    expect(entries[0]!.to).toBe('auth');
    expect(entries[0]!.msg).toBe('Finish auth task');
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

describe('Message thread field', () => {
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

  it('round-trips a message with thread', () => {
    const threadId = generateThreadId();
    appendMessage(
      'api',
      { type: 'send', to: 'auth', msg: 'What type?', thread: threadId },
      repoDir,
    );

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBe(threadId);
  });

  it('parses old entries without thread field cleanly', () => {
    appendMessage('auth', { type: 'broadcast', msg: 'No thread here' }, repoDir);

    const entries = readMessages(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thread).toBeUndefined();
    expect(entries[0]!.msg).toBe('No thread here');
  });
});

describe('readMessagesForTask', () => {
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
    appendMessage('auth', { type: 'broadcast', msg: 'Changed interface' }, repoDir);
    appendMessage('api', { type: 'send', to: 'auth', msg: 'What type?' }, repoDir);
    appendMessage('dashboard', { type: 'send', to: 'api', msg: 'Endpoint ready?' }, repoDir);

    // auth should see: the broadcast (it's own but all broadcasts are shown),
    // and the ask directed at it
    const forAuth = readMessagesForTask('auth', repoDir);
    const directed = forAuth.filter((e) => e.to === 'auth');
    expect(directed).toHaveLength(1);
    expect(directed[0]!.from).toBe('api');

    // api should see the message directed at it
    const forApi = readMessagesForTask('api', repoDir);
    const directedToApi = forApi.filter((e) => e.to === 'api');
    expect(directedToApi).toHaveLength(1);
    expect(directedToApi[0]!.from).toBe('dashboard');
  });

  it('filters by since timestamp', () => {
    appendMessage('auth', { type: 'broadcast', msg: 'Old message' }, repoDir);
    appendMessage('api', { type: 'broadcast', msg: 'New message' }, repoDir);

    const allEntries = readMessages(repoDir);
    expect(allEntries).toHaveLength(2);

    // Use a timestamp far in the past -- both entries should be included
    const ancient = '2020-01-01T00:00:00.000Z';
    const afterAncient = readMessagesForTask('dashboard', repoDir, ancient);
    expect(afterAncient).toHaveLength(2);

    // Use a timestamp far in the future -- no entries should be included
    const future = '2099-01-01T00:00:00.000Z';
    const afterFuture = readMessagesForTask('dashboard', repoDir, future);
    expect(afterFuture).toHaveLength(0);

    // Use the first entry's timestamp -- should exclude it
    const since = allEntries[0]!.ts;
    const afterFirst = readMessagesForTask('dashboard', repoDir, since);
    // The old entry (at or before `since`) is excluded
    const msgs = afterFirst.map((e) => e.msg);
    expect(msgs).not.toContain('Old message');
  });

  it('includes nudges directed at the task', () => {
    appendMessage('orchestrator', { type: 'nudge', to: 'auth', msg: 'Finish up' }, repoDir);
    appendMessage('orchestrator', { type: 'nudge', to: 'api', msg: 'Speed up' }, repoDir);

    const forAuth = readMessagesForTask('auth', repoDir);
    expect(forAuth).toHaveLength(1);
    expect(forAuth[0]!.msg).toBe('Finish up');
  });
});
