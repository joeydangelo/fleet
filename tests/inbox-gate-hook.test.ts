import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { installHooks } from '../src/lib/hooks.js';
import { makeTempDir } from './helpers/temp.js';

describe('inbox gate hook script', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('installs the inbox gate script file', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'hooks', 'paw-inbox-gate.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('.paw/tasks/*.md');
    expect(content).toContain('exit 2');
    expect(content).toContain('.paw/run/.unanswered-');
  });

  it('registers inbox gate as PreToolUse with empty matcher (all tools)', () => {
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );

    const preToolUse = settings.hooks.PreToolUse;
    // Should have guard (Bash|Edit|Write matcher) + inbox gate (empty matcher)
    expect(preToolUse).toHaveLength(2);

    // First is the existing guard with specific matcher
    expect(preToolUse[0]).toHaveProperty('matcher', 'Bash|Edit|Write');
    expect(preToolUse[0].hooks[0].command).toContain('paw-guard.sh');

    // Second is inbox gate with empty matcher (fires on all tools)
    expect(preToolUse[1]).toHaveProperty('matcher', '');
    expect(preToolUse[1].hooks[0].command).toContain('paw-inbox-gate.sh');
  });

  it('is idempotent — does not duplicate inbox gate hooks', () => {
    installHooks(repoRoot);
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );

    expect(settings.hooks.PreToolUse).toHaveLength(2);
  });
});

describe('inbox gate bash script execution', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    installHooks(repoRoot);
    // Create a task file to make it look like a paw worktree
    mkdirSync(resolve(repoRoot, '.paw', 'tasks'), { recursive: true });
    writeFileSync(resolve(repoRoot, '.paw', 'tasks', 'my-task.md'), '# Task');
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('allows when flag file is missing (exit 0, no output)', () => {
    const input = JSON.stringify({ tool_name: 'Read', tool_input: {} });
    const result = execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('');
  });

  it('denies Read tool when flag file exists (exit 2, stderr has reason)', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({ tool_name: 'Read', tool_input: {} });
    try {
      execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      expect(e.status).toBe(2);
      expect(e.stderr).toContain('unanswered');
    }
  });

  it('denies Edit tool when flag file exists (exit 2, stderr has reason)', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'foo.ts' } });
    try {
      execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      expect(e.status).toBe(2);
      expect(e.stderr).toContain('unanswered');
    }
  });

  it('denies Write tool when flag file exists (exit 2, stderr has reason)', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'bar.ts' } });
    try {
      execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      expect(e.status).toBe(2);
      expect(e.stderr).toContain('unanswered');
    }
  });

  it('allows paw commands even when flag file exists', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'paw reply other-task "here is the answer"' },
    });
    const result = execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('');
  });

  it('denies non-paw Bash commands when flag file exists (exit 2)', () => {
    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'cat file.txt' },
    });
    try {
      execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
        cwd: repoRoot,
        encoding: 'utf-8',
      });
      expect.unreachable('should have thrown');
    } catch (err: unknown) {
      const e = err as { status: number; stderr: string };
      expect(e.status).toBe(2);
      expect(e.stderr).toContain('unanswered');
    }
  });

  it('allows all tools when no task file exists (not a paw worktree)', () => {
    // Remove the task file
    rmSync(resolve(repoRoot, '.paw', 'tasks'), { recursive: true, force: true });

    mkdirSync(resolve(repoRoot, '.paw', 'run'), { recursive: true });
    writeFileSync(
      resolve(repoRoot, '.paw', 'run', '.unanswered-my-task'),
      'You have 1 unanswered message',
    );

    const input = JSON.stringify({ tool_name: 'Read', tool_input: {} });
    const result = execSync(`echo '${input}' | bash .claude/hooks/paw-inbox-gate.sh`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(result.trim()).toBe('');
  });
});
