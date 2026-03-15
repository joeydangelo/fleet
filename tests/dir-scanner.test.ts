import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  parsePathInput,
  scanDirectories,
  isGitRepo,
  resolveGitRoot,
} from '../src/lib/dir-scanner.js';

const TEST_ROOT = join(tmpdir(), 'fleet-dir-scanner-test');

function setup() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
}

function teardown() {
  rmSync(TEST_ROOT, { recursive: true, force: true });
}

describe('parsePathInput', () => {
  it('returns homedir with empty prefix for empty input', () => {
    const result = parsePathInput('');
    expect(result.prefix).toBe('');
    expect(result.parentDir).toBe(homedir());
  });

  it('splits path with trailing slash into parentDir + empty prefix', () => {
    const result = parsePathInput('/tmp/repos/');
    expect(result.parentDir).toBe('/tmp/repos');
    expect(result.prefix).toBe('');
  });

  it('splits path without trailing slash into dirname + basename prefix', () => {
    const result = parsePathInput('/tmp/repos/pa');
    expect(result.parentDir).toBe('/tmp/repos');
    expect(result.prefix).toBe('pa');
  });

  it('handles root path', () => {
    const result = parsePathInput('/');
    expect(result.parentDir).toBe('/');
    expect(result.prefix).toBe('');
  });

  it('expands ~ to homedir', () => {
    const result = parsePathInput('~/pro');
    expect(result.parentDir).toBe(homedir());
    expect(result.prefix).toBe('pro');
  });

  it('expands bare ~ to homedir parent with homedir basename as prefix', () => {
    const result = parsePathInput('~');
    // ~ expands to homedir; no trailing slash so dirname/basename splits it
    expect(result.parentDir).toBe(dirname(homedir()));
    expect(result.prefix).toBe(basename(homedir()));
  });

  it('handles absolute path with no directory component', () => {
    const result = parsePathInput('/tmp');
    expect(result.parentDir).toBe('/');
    expect(result.prefix).toBe('tmp');
  });
});

describe('isGitRepo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns true for a directory with .git/', () => {
    const repo = join(TEST_ROOT, 'myrepo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(isGitRepo(repo)).toBe(true);
  });

  it('returns true for a directory with .git file (worktree)', () => {
    const wt = join(TEST_ROOT, 'worktree');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), 'gitdir: /some/path/.git/worktrees/wt');
    expect(isGitRepo(wt)).toBe(true);
  });

  it('returns false for a directory without .git', () => {
    const plain = join(TEST_ROOT, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(isGitRepo(plain)).toBe(false);
  });

  it('returns false for a non-existent path', () => {
    expect(isGitRepo(join(TEST_ROOT, 'nope'))).toBe(false);
  });
});

describe('resolveGitRoot', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('returns the repo root when cwd is the root', () => {
    const repo = join(TEST_ROOT, 'myrepo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(resolveGitRoot(repo)).toBe(repo);
  });

  it('walks up from a nested subdirectory to find the root', () => {
    const repo = join(TEST_ROOT, 'myrepo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const nested = join(repo, 'src', 'lib');
    mkdirSync(nested, { recursive: true });
    expect(resolveGitRoot(nested)).toBe(repo);
  });

  it('returns null for a non-git directory', () => {
    const plain = join(TEST_ROOT, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(resolveGitRoot(plain)).toBeNull();
  });

  it('does not walk past filesystem root', () => {
    // Just checking it terminates gracefully
    expect(resolveGitRoot('/tmp/unlikely-nonexistent-deep/path')).toBeNull();
  });
});

describe('scanDirectories', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('lists subdirectories with git detection', () => {
    const gitRepo = join(TEST_ROOT, 'alpha');
    mkdirSync(join(gitRepo, '.git'), { recursive: true });
    const plain = join(TEST_ROOT, 'beta');
    mkdirSync(plain, { recursive: true });

    const entries = scanDirectories(TEST_ROOT, '');
    expect(entries.length).toBe(2);
    // Git repos sorted first
    expect(entries[0]!.name).toBe('alpha');
    expect(entries[0]!.isGitRepo).toBe(true);
    expect(entries[1]!.name).toBe('beta');
    expect(entries[1]!.isGitRepo).toBe(false);
  });

  it('filters by case-insensitive prefix', () => {
    mkdirSync(join(TEST_ROOT, 'Apple'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'apricot'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'banana'), { recursive: true });

    const entries = scanDirectories(TEST_ROOT, 'ap');
    expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(['Apple', 'apricot']));
    expect(entries.length).toBe(2);
  });

  it('hides hidden directories by default', () => {
    mkdirSync(join(TEST_ROOT, '.hidden'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'visible'), { recursive: true });

    const entries = scanDirectories(TEST_ROOT, '');
    expect(entries.map((e) => e.name)).toEqual(['visible']);
  });

  it('shows hidden directories when prefix starts with dot', () => {
    mkdirSync(join(TEST_ROOT, '.config'), { recursive: true });
    mkdirSync(join(TEST_ROOT, '.cache'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'visible'), { recursive: true });

    const entries = scanDirectories(TEST_ROOT, '.c');
    expect(entries.map((e) => e.name).sort()).toEqual(['.cache', '.config']);
  });

  it('sorts git repos first, then alphabetical', () => {
    mkdirSync(join(TEST_ROOT, 'zebra', '.git'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'alpha'), { recursive: true });
    mkdirSync(join(TEST_ROOT, 'beta', '.git'), { recursive: true });

    const entries = scanDirectories(TEST_ROOT, '');
    expect(entries.map((e) => e.name)).toEqual(['beta', 'zebra', 'alpha']);
  });

  it('returns max 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      mkdirSync(join(TEST_ROOT, `dir-${String(i).padStart(3, '0')}`), { recursive: true });
    }

    const entries = scanDirectories(TEST_ROOT, '');
    expect(entries.length).toBe(50);
  });

  it('returns empty array for non-existent directory', () => {
    const entries = scanDirectories(join(TEST_ROOT, 'nope'), '');
    expect(entries).toEqual([]);
  });

  it('returns only directories, not files', () => {
    mkdirSync(join(TEST_ROOT, 'adir'), { recursive: true });
    writeFileSync(join(TEST_ROOT, 'afile.txt'), 'content');

    const entries = scanDirectories(TEST_ROOT, '');
    expect(entries.length).toBe(1);
    expect(entries[0]!.name).toBe('adir');
  });
});
