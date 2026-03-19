import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getCommitCount } from '../src/lib/git.js';

describe('getCommitCount', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = resolve(tmpdir(), `fleet-test-git-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    // Create initial commit on main
    writeFileSync(resolve(repoDir, 'init.txt'), 'init');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns correct count for commits ahead of base', () => {
    execSync('git checkout -b feature', { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(resolve(repoDir, 'a.txt'), 'a');
    execSync('git add . && git commit -m "one"', { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(resolve(repoDir, 'b.txt'), 'b');
    execSync('git add . && git commit -m "two"', { cwd: repoDir, stdio: 'ignore' });

    expect(getCommitCount('feature', 'main', repoDir)).toBe(2);
  });

  it('returns 0 when branch has no commits ahead', () => {
    expect(getCommitCount('main', 'main', repoDir)).toBe(0);
  });

  it('returns 0 for invalid branch (instead of NaN)', () => {
    expect(getCommitCount('nonexistent-branch', 'main', repoDir)).toBe(0);
  });
});
