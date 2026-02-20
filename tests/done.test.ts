import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateSummary, REQUIRED_SECTIONS, generateErrorTemplate } from '../src/lib/summary.js';
import { generateTaskFile } from '../src/lib/session.js';
import type { PawConfig } from '../src/lib/config.js';
import {
  initSyncState,
  writeSyncState,
  initSyncWorktree,
  removeSyncWorktree,
  readSyncFile,
} from '../src/lib/sync.js';

describe('validateSummary', () => {
  const validSummary = `## What I did
- Added OAuth2 login flow

## Interface changes
- AuthMiddleware now takes OAuthConfig

## Watch out
- Token refresh requires OAUTH_SECRET env var`;

  it('accepts a summary with all required sections', () => {
    const result = validateSummary(validSummary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects a summary missing 'What I did'", () => {
    const summary = `## Interface changes
- Changed exports

## Watch out
- Nothing`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('What I did');
  });

  it("rejects a summary missing 'Interface changes'", () => {
    const summary = `## What I did
- Built the thing

## Watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('Interface changes');
  });

  it("rejects a summary missing 'Watch out'", () => {
    const summary = `## What I did
- Built the thing

## Interface changes
- New export`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('Watch out');
  });

  it('rejects a flat paragraph with no sections', () => {
    const summary = 'I finished the auth work, everything should be good.';

    const result = validateSummary(summary);

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(REQUIRED_SECTIONS);
  });

  it('accepts sections with ### heading level', () => {
    const summary = `### What I did
- Built the thing

### Interface changes
- New export

### Watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('is case-insensitive for section headers', () => {
    const summary = `## what i did
- Built the thing

## interface changes
- New export

## watch out
- Be careful`;

    const result = validateSummary(summary);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports all missing sections at once', () => {
    const summary = 'Just a paragraph.';

    const result = validateSummary(summary);

    expect(result.missing).toHaveLength(3);
    expect(result.missing).toContain('What I did');
    expect(result.missing).toContain('Interface changes');
    expect(result.missing).toContain('Watch out');
  });
});

describe('summary template single source of truth (paw-em2l)', () => {
  it('generateErrorTemplate contains all REQUIRED_SECTIONS', () => {
    const template = generateErrorTemplate();
    for (const section of REQUIRED_SECTIONS) {
      expect(template).toContain(`## ${section}`);
    }
  });

  it('task file template contains all REQUIRED_SECTIONS as headings', () => {
    const config: PawConfig = {
      base: 'main',
      target: 'feature/dash',
      tasks: { auth: { focus: 'src/auth/' } },
    };
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dash-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const taskFile = generateTaskFile(config, worktree);
    for (const section of REQUIRED_SECTIONS) {
      expect(taskFile).toContain(`### ${section}`);
    }
  });
});

describe('paw done stdin (paw-icic)', () => {
  let repoDir: string;
  const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');

  const validSummary = `## What I did
- Added OAuth2 login flow with Google and GitHub providers

## Interface changes
- AuthMiddleware now takes OAuthConfig instead of raw token

## Watch out
- Token refresh requires OAUTH_SECRET env var`;

  beforeEach(() => {
    repoDir = resolve(
      tmpdir(),
      `paw-done-stdin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', repoDir], { stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });
    initSyncWorktree(repoDir);
    const state = initSyncState('feature/dash', ['auth'], 'paw.yaml');
    writeSyncState(state, repoDir);
    mkdirSync(resolve(repoDir, '.paw', 'tasks'), { recursive: true });
    writeFileSync(resolve(repoDir, '.paw', 'tasks', 'auth.md'), '# auth task');
  });

  afterEach(() => {
    removeSyncWorktree(repoDir);
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('reads summary from piped stdin when --summary is not provided', () => {
    const result = execFileSync(process.execPath, [binPath, 'done'], {
      cwd: repoDir,
      input: validSummary,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(result.toString()).toContain('auth -- marked as done');
  });

  it('summary written via stdin matches piped content exactly', () => {
    execFileSync(process.execPath, [binPath, 'done'], {
      cwd: repoDir,
      input: validSummary,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const written = readSyncFile('summaries/auth.md', repoDir);
    expect(written).toBe(validSummary);
  });

  it('--summary flag still works unchanged', () => {
    const result = execFileSync(process.execPath, [binPath, 'done', '--summary', validSummary], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    expect(result.toString()).toContain('auth -- marked as done');
  });

  it('piped invalid summary exits 1 with validation error', () => {
    try {
      execFileSync(process.execPath, [binPath, 'done'], {
        cwd: repoDir,
        input: 'Just a paragraph, no sections.',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect.fail('should have exited with code 1');
    } catch (err: any) {
      expect(err.status).toBe(1);
      const stderr = err.stderr?.toString() ?? '';
      expect(stderr).toMatch(/missing required sections/i);
    }
  });
});
