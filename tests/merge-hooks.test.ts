import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { initSyncWorktree, removeSyncWorktree, writeSyncFile } from '../src/lib/sync.js';
import { isMergeInProgress, mergeBranch } from '../src/lib/git.js';
import {
  extractConflictBrief,
  runAutoResolveHook,
  tryAutoResolveConflict,
  tryAutoResolveHookFailure,
} from '../src/lib/merge-hooks.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-mh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', dir], { stdio: 'pipe' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('extractConflictBrief', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    initSyncWorktree(repoDir);
  });

  afterEach(() => {
    try {
      removeSyncWorktree(repoDir);
    } catch {
      // already removed
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('extracts brief from sync branch to .paw/tmp/conflict-brief.md', () => {
    const briefContent =
      '# Merge Conflict: auth into feature/dash\n\n## Conflicting files\n- src/shared.ts\n';
    writeSyncFile('conflicts/auth-into-target.md', briefContent, repoDir);

    const result = extractConflictBrief('auth', repoDir);

    const expectedPath = resolve(repoDir, '.paw', 'tmp', 'conflict-brief.md');
    expect(result).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf-8')).toBe(briefContent);
  });

  it('creates .paw/tmp/ directory if it does not exist', () => {
    const briefContent = '# Brief\n';
    writeSyncFile('conflicts/api-into-target.md', briefContent, repoDir);

    const tmpDir = resolve(repoDir, '.paw', 'tmp');
    expect(existsSync(tmpDir)).toBe(false);

    extractConflictBrief('api', repoDir);

    expect(existsSync(tmpDir)).toBe(true);
  });

  it('returns null when brief does not exist on sync branch', () => {
    const result = extractConflictBrief('nonexistent', repoDir);
    expect(result).toBeNull();
  });

  it('overwrites existing brief file on subsequent calls', () => {
    writeSyncFile('conflicts/auth-into-target.md', 'first version', repoDir);
    extractConflictBrief('auth', repoDir);

    writeSyncFile('conflicts/auth-into-target.md', 'second version', repoDir);
    extractConflictBrief('auth', repoDir);

    const briefPath = resolve(repoDir, '.paw', 'tmp', 'conflict-brief.md');
    expect(readFileSync(briefPath, 'utf-8')).toBe('second version');
  });
});

describe('runAutoResolveHook', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns 0 when command succeeds', () => {
    const exitCode = runAutoResolveHook('true', repoDir, {});
    expect(exitCode).toBe(0);
  });

  it('returns non-zero when command fails', () => {
    const exitCode = runAutoResolveHook('false', repoDir, {});
    expect(exitCode).not.toBe(0);
  });

  it('passes environment variables to the command', () => {
    const outFile = resolve(repoDir, 'env-out.txt');
    const command = `node -e "require('fs').writeFileSync('env-out.txt', process.env.PAW_CONFLICT_TASK + '|' + process.env.PAW_TARGET)"`;

    const exitCode = runAutoResolveHook(command, repoDir, {
      PAW_CONFLICT_TASK: 'auth',
      PAW_TARGET: 'feature/dash',
    });

    expect(exitCode).toBe(0);
    const output = readFileSync(outFile, 'utf-8').trim();
    expect(output).toBe('auth|feature/dash');
  });

  it('sets on-conflict env vars correctly', () => {
    const outFile = resolve(repoDir, 'env-out.txt');
    const briefPath = resolve(repoDir, 'conflict-brief.md');
    const command = `node -e "require('fs').writeFileSync('env-out.txt', process.env.PAW_CONFLICT_TASK + '|' + process.env.PAW_CONFLICT_BRIEF + '|' + process.env.PAW_TARGET)"`;

    runAutoResolveHook(command, repoDir, {
      PAW_CONFLICT_TASK: 'auth',
      PAW_CONFLICT_BRIEF: briefPath,
      PAW_TARGET: 'feature/dash',
    });

    const output = readFileSync(outFile, 'utf-8').trim();
    expect(output).toBe(`auth|${briefPath}|feature/dash`);
  });

  it('sets on-hook-failure env vars correctly', () => {
    const outFile = resolve(repoDir, 'env-out.txt');
    const command = `node -e "require('fs').writeFileSync('env-out.txt', process.env.PAW_FAILED_TASK + '|' + process.env.PAW_HOOK_COMMAND + '|' + process.env.PAW_BACKUP_REF + '|' + process.env.PAW_TARGET)"`;

    runAutoResolveHook(command, repoDir, {
      PAW_FAILED_TASK: 'api',
      PAW_HOOK_COMMAND: 'pnpm test',
      PAW_BACKUP_REF: 'refs/paw-backup/api',
      PAW_TARGET: 'feature/dash',
    });

    const output = readFileSync(outFile, 'utf-8').trim();
    expect(output).toBe('api|pnpm test|refs/paw-backup/api|feature/dash');
  });

  it('inherits existing process env vars', () => {
    const outFile = resolve(repoDir, 'env-out.txt');
    const command = `node -e "require('fs').writeFileSync('env-out.txt', process.env.HOME || process.env.USERPROFILE || 'none')"`;

    runAutoResolveHook(command, repoDir, {});

    const output = readFileSync(outFile, 'utf-8').trim();
    expect(output).not.toBe('none');
    expect(output.length).toBeGreaterThan(0);
  });
});

function commitFile(dir: string, filename: string, content: string, message: string): void {
  writeFileSync(resolve(dir, filename), content);
  execFileSync('git', ['add', filename], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', message], { cwd: dir, stdio: 'pipe' });
}

/** Create a conflict: branch-a and main both modify the same file. Leave git in merge state. */
function createConflict(repoDir: string): void {
  execFileSync('git', ['checkout', '-b', 'branch-a'], { cwd: repoDir, stdio: 'pipe' });
  commitFile(repoDir, 'shared.txt', 'content-a', 'branch-a commit');

  execFileSync('git', ['checkout', 'main'], { cwd: repoDir, stdio: 'pipe' });
  commitFile(repoDir, 'shared.txt', 'content-main', 'main commit');

  // Attempt merge -- will conflict, leaving git in merge state
  mergeBranch('branch-a', repoDir);
}

describe('tryAutoResolveConflict', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    try {
      execFileSync('git', ['merge', '--abort'], { cwd: repoDir, stdio: 'pipe' });
    } catch {
      // No merge in progress
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns true when hook resolves the conflict', () => {
    createConflict(repoDir);
    expect(isMergeInProgress(repoDir)).toBe(true);

    const hookCommand = `node -e "const fs=require('fs'); fs.writeFileSync('shared.txt','resolved'); require('child_process').execFileSync('git',['add','shared.txt'],{stdio:'pipe'}); require('child_process').execFileSync('git',['commit','--no-edit'],{stdio:'pipe'})"`;

    const resolved = tryAutoResolveConflict({
      hookCommand,
      taskName: 'auth',
      target: 'feature/dash',
      briefPath: resolve(repoDir, 'brief.md'),
      cwd: repoDir,
    });

    expect(resolved).toBe(true);
    expect(isMergeInProgress(repoDir)).toBe(false);
  });

  it('returns false when hook does not resolve the conflict', () => {
    createConflict(repoDir);

    const resolved = tryAutoResolveConflict({
      hookCommand: 'true',
      taskName: 'auth',
      target: 'feature/dash',
      briefPath: resolve(repoDir, 'brief.md'),
      cwd: repoDir,
    });

    expect(resolved).toBe(false);
    expect(isMergeInProgress(repoDir)).toBe(true);
  });

  it('returns false when hook command fails', () => {
    createConflict(repoDir);

    const resolved = tryAutoResolveConflict({
      hookCommand: 'false',
      taskName: 'auth',
      target: 'feature/dash',
      briefPath: resolve(repoDir, 'brief.md'),
      cwd: repoDir,
    });

    expect(resolved).toBe(false);
  });
});

describe('tryAutoResolveHookFailure', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns true when hook fixes the issue and post-merge re-passes', () => {
    writeFileSync(resolve(repoDir, 'check.txt'), 'broken');
    execFileSync('git', ['add', 'check.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add broken file'], { cwd: repoDir, stdio: 'pipe' });

    const postMergeHook = `node -e "const c=require('fs').readFileSync('check.txt','utf-8'); if(c.includes('broken')) process.exit(1)"`;
    const hookCommand = `node -e "require('fs').writeFileSync('check.txt','fixed'); require('child_process').execFileSync('git',['add','check.txt'],{stdio:'pipe'}); require('child_process').execFileSync('git',['commit','-m','fix'],{stdio:'pipe'})"`;

    const resolved = tryAutoResolveHookFailure({
      hookCommand,
      taskName: 'api',
      target: 'feature/dash',
      postMergeHook,
      backupRef: 'refs/paw-backup/api',
      cwd: repoDir,
    });

    expect(resolved).toBe(true);
  });

  it('returns false when post-merge still fails after hook', () => {
    const resolved = tryAutoResolveHookFailure({
      hookCommand: 'true',
      taskName: 'api',
      target: 'feature/dash',
      postMergeHook: 'false',
      backupRef: 'refs/paw-backup/api',
      cwd: repoDir,
    });

    expect(resolved).toBe(false);
  });

  it('returns false when hook command itself fails', () => {
    const resolved = tryAutoResolveHookFailure({
      hookCommand: 'false',
      taskName: 'api',
      target: 'feature/dash',
      postMergeHook: 'false',
      backupRef: 'refs/paw-backup/api',
      cwd: repoDir,
    });

    expect(resolved).toBe(false);
  });

  it('re-runs post-merge hook to verify the fix', () => {
    const counterFile = resolve(repoDir, '.pm-count');
    writeFileSync(counterFile, '0');

    const postMergeHook = `node -e "const fs=require('fs'); let c=parseInt(fs.readFileSync('.pm-count','utf-8')); c++; fs.writeFileSync('.pm-count',String(c))"`;
    const hookCommand = 'true';

    tryAutoResolveHookFailure({
      hookCommand,
      taskName: 'api',
      target: 'feature/dash',
      postMergeHook,
      backupRef: 'refs/paw-backup/api',
      cwd: repoDir,
    });

    // post-merge ran exactly once to verify
    expect(readFileSync(counterFile, 'utf-8')).toBe('1');
  });
});
