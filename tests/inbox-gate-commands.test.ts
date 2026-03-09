import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeThreads,
  writeGateFlag,
  clearGateFlag,
  formatGateContent,
} from '../src/commands/inbox.js';
import type { OpenThread } from '../src/commands/inbox.js';
import type { Message } from '../src/lib/messages.js';
import { INBOX_GATE_PREFIX } from '../src/lib/constants.js';

function msg(overrides: Partial<Message> & { thread?: string }): Message {
  return {
    ts: new Date().toISOString(),
    from: 'orchestrator',
    type: 'broadcast',
    msg: 'test',
    ...overrides,
  } as Message;
}

/** Create a send message with a required thread field, suitable for OpenThread. */
function sendMsg(
  overrides: Omit<Partial<Message>, 'thread'> & {
    thread: string;
    to: string;
    from: string;
    msg: string;
  },
): Message & { thread: string } {
  return {
    ts: new Date().toISOString(),
    type: 'send' as const,
    ...overrides,
  };
}

describe('inbox gate flag file management', () => {
  let tmpDir: string;
  const taskName = 'shapes-task';

  beforeEach(() => {
    tmpDir = join(tmpdir(), `paw-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.paw', 'run'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function flagPath(): string {
    return join(tmpDir, `${INBOX_GATE_PREFIX}${taskName}`);
  }

  describe('formatGateContent', () => {
    it('formats unanswered messages into human-readable block', () => {
      const threads: OpenThread[] = [
        {
          send: sendMsg({
            from: 'api-task',
            to: taskName,
            msg: 'What interface fields?',
            thread: 'ab3c1234',
          }),
        },
        {
          send: sendMsg({
            from: 'auth-task',
            to: taskName,
            msg: 'What token format?',
            thread: 'xk9p5678',
          }),
        },
      ];

      const content = formatGateContent(threads);

      expect(content).toContain('2 unanswered message(s)');
      expect(content).toContain('(ab3c) api-task');
      expect(content).toContain('"What interface fields?"');
      expect(content).toContain('(xk9p) auth-task');
      expect(content).toContain('"What token format?"');
      expect(content).toContain('paw reply <task> "your answer"');
    });
  });

  describe('writeGateFlag', () => {
    it('creates flag file with formatted content when unanswered messages exist', () => {
      const threads: OpenThread[] = [
        {
          send: sendMsg({
            from: 'api-task',
            to: taskName,
            msg: 'What interface fields?',
            thread: 'ab3c1234',
          }),
        },
      ];

      writeGateFlag(tmpDir, taskName, threads);

      expect(existsSync(flagPath())).toBe(true);
      const content = readFileSync(flagPath(), 'utf-8');
      expect(content).toContain('1 unanswered message(s)');
      expect(content).toContain('api-task');
    });

    it('creates .paw/run/ directory if it does not exist', () => {
      rmSync(join(tmpDir, '.paw', 'run'), { recursive: true, force: true });
      const threads: OpenThread[] = [
        { send: sendMsg({ from: 'api-task', to: taskName, msg: 'Hello?', thread: 'abcd1234' }) },
      ];

      writeGateFlag(tmpDir, taskName, threads);

      expect(existsSync(flagPath())).toBe(true);
    });
  });

  describe('clearGateFlag', () => {
    it('deletes flag file when it exists', () => {
      writeFileSync(flagPath(), 'some content');
      expect(existsSync(flagPath())).toBe(true);

      clearGateFlag(tmpDir, taskName);

      expect(existsSync(flagPath())).toBe(false);
    });

    it('does not error when flag file does not exist', () => {
      expect(existsSync(flagPath())).toBe(false);

      expect(() => clearGateFlag(tmpDir, taskName)).not.toThrow();
    });
  });

  describe('inbox command flag lifecycle', () => {
    it('paw inbox with unanswered messages creates flag file', () => {
      const entries = [
        msg({ type: 'send', from: 'api-task', to: taskName, msg: 'What fields?', thread: 'th01' }),
      ];
      const { open } = computeThreads(entries);
      const unanswered = open.filter((t) => t.send.to === taskName);

      expect(unanswered.length).toBeGreaterThan(0);
      writeGateFlag(tmpDir, taskName, unanswered);

      expect(existsSync(flagPath())).toBe(true);
      const content = readFileSync(flagPath(), 'utf-8');
      expect(content).toContain('1 unanswered message(s)');
    });

    it('paw inbox with no unanswered messages deletes flag file', () => {
      // Pre-existing flag file
      writeFileSync(flagPath(), 'old content');
      expect(existsSync(flagPath())).toBe(true);

      const entries = [
        msg({ type: 'send', from: 'api-task', to: taskName, msg: 'What fields?', thread: 'th01' }),
        msg({ type: 'reply', from: taskName, to: 'api-task', msg: 'Field A, B', thread: 'th01' }),
      ];
      const { open } = computeThreads(entries);
      const unanswered = open.filter((t) => t.send.to === taskName);

      expect(unanswered).toHaveLength(0);
      clearGateFlag(tmpDir, taskName);

      expect(existsSync(flagPath())).toBe(false);
    });

    it('paw inbox with no unanswered and no flag file does not error', () => {
      expect(existsSync(flagPath())).toBe(false);

      const entries: Message[] = [];
      const { open } = computeThreads(entries);
      const unanswered = open.filter((t) => t.send.to === taskName);

      expect(unanswered).toHaveLength(0);
      expect(() => clearGateFlag(tmpDir, taskName)).not.toThrow();
    });
  });

  describe('reply command flag lifecycle', () => {
    it('clears flag when last unanswered message is replied to', () => {
      // Setup: one unanswered message, flag file exists
      writeFileSync(flagPath(), 'content');

      const entries = [
        msg({ type: 'send', from: 'api-task', to: taskName, msg: 'What fields?', thread: 'th01' }),
        msg({ type: 'reply', from: taskName, to: 'api-task', msg: 'Field A', thread: 'th01' }),
      ];
      const { open } = computeThreads(entries);
      const remaining = open.filter((t) => t.send.to === taskName);

      expect(remaining).toHaveLength(0);
      clearGateFlag(tmpDir, taskName);

      expect(existsSync(flagPath())).toBe(false);
    });

    it('updates flag when other unanswered messages remain', () => {
      // Two unanswered, reply to one
      const entries = [
        msg({ type: 'send', from: 'api-task', to: taskName, msg: 'What fields?', thread: 'th01' }),
        msg({
          type: 'send',
          from: 'auth-task',
          to: taskName,
          msg: 'Token format?',
          thread: 'th02',
        }),
        msg({ type: 'reply', from: taskName, to: 'api-task', msg: 'Field A', thread: 'th01' }),
      ];
      const { open } = computeThreads(entries);
      const remaining = open.filter((t) => t.send.to === taskName);

      expect(remaining).toHaveLength(1);
      writeGateFlag(tmpDir, taskName, remaining);

      expect(existsSync(flagPath())).toBe(true);
      const content = readFileSync(flagPath(), 'utf-8');
      expect(content).toContain('1 unanswered message(s)');
      expect(content).toContain('auth-task');
      expect(content).not.toContain('api-task');
    });
  });
});
