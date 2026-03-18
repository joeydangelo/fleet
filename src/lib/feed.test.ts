import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitEvent, formatTimestamp, getFeedPath, FEED_DIR } from './feed.js';

// Use a real temp directory for integration tests
const TEST_ROOT = resolve(import.meta.dirname, '../../.test-feed-tmp');

describe('formatTimestamp', () => {
  it('returns HH:MM:SS format', () => {
    const date = new Date(2026, 2, 18, 14, 5, 9);
    expect(formatTimestamp(date)).toBe('14:05:09');
  });

  it('zero-pads single digits', () => {
    const date = new Date(2026, 0, 1, 1, 2, 3);
    expect(formatTimestamp(date)).toBe('01:02:03');
  });
});

describe('emitEvent', () => {
  beforeEach(() => {
    mkdirSync(TEST_ROOT, { recursive: true });
    // Create a .fleet/tasks/ with no task file → getTaskIdentity returns 'orchestrator'
    mkdirSync(resolve(TEST_ROOT, '.fleet', 'tasks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates feed file and writes valid JSON line', () => {
    emitEvent({ event: 'test.basic', task: 'alpha' }, TEST_ROOT);

    const feedPath = getFeedPath(TEST_ROOT);
    expect(existsSync(feedPath)).toBe(true);

    const content = readFileSync(feedPath, 'utf-8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe('test.basic');
    expect(parsed.task).toBe('alpha');
    expect(parsed.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('appends multiple lines on repeated calls', () => {
    emitEvent({ event: 'first', task: 'a' }, TEST_ROOT);
    emitEvent({ event: 'second', task: 'b' }, TEST_ROOT);
    emitEvent({ event: 'third', task: 'c' }, TEST_ROOT);

    const content = readFileSync(getFeedPath(TEST_ROOT), 'utf-8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(3);

    expect(JSON.parse(lines[0]!).event).toBe('first');
    expect(JSON.parse(lines[1]!).event).toBe('second');
    expect(JSON.parse(lines[2]!).event).toBe('third');
  });

  it('auto-detects task as orchestrator when no task file exists', () => {
    emitEvent({ event: 'test.auto' }, TEST_ROOT);

    const content = readFileSync(getFeedPath(TEST_ROOT), 'utf-8');
    const parsed = JSON.parse(content.trimEnd());
    expect(parsed.task).toBe('orchestrator');
  });

  it('auto-detects task name from single task file', () => {
    writeFileSync(resolve(TEST_ROOT, '.fleet', 'tasks', 'myagent.md'), '# Task: myagent\n');

    emitEvent({ event: 'test.detect' }, TEST_ROOT);

    const content = readFileSync(getFeedPath(TEST_ROOT), 'utf-8');
    const parsed = JSON.parse(content.trimEnd());
    expect(parsed.task).toBe('myagent');
  });

  it('preserves extra fields in the JSON line', () => {
    emitEvent({ event: 'tool.Read', task: 'alpha', file: 'src/main.ts' }, TEST_ROOT);

    const content = readFileSync(getFeedPath(TEST_ROOT), 'utf-8');
    const parsed = JSON.parse(content.trimEnd());
    expect(parsed.file).toBe('src/main.ts');
  });

  it('creates .fleet/run/ directory if missing', () => {
    const runDir = resolve(TEST_ROOT, FEED_DIR);
    expect(existsSync(runDir)).toBe(false);

    emitEvent({ event: 'test.mkdir', task: 'alpha' }, TEST_ROOT);

    expect(existsSync(runDir)).toBe(true);
  });

  it('each line is valid NDJSON (parseable independently)', () => {
    for (let i = 0; i < 5; i++) {
      emitEvent({ event: `batch.${i}`, task: 'worker', index: i }, TEST_ROOT);
    }

    const content = readFileSync(getFeedPath(TEST_ROOT), 'utf-8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(5);

    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });
});
