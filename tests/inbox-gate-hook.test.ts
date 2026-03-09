import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { installHooks } from '../src/lib/hooks.js';
import { makeTempDir } from './helpers/temp.js';

/**
 * Simulate the inbox gate hook logic in TypeScript.
 * This mirrors the bash script's behavior for testability.
 */
function simulateInboxGate(opts: {
  hasTaskFile: boolean;
  taskName?: string;
  flagFileExists: boolean;
  flagFileContents?: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
}): { decision: 'allow' | 'deny'; reason?: string } {
  // Not a paw worktree — allow
  if (!opts.hasTaskFile) {
    return { decision: 'allow' };
  }

  // No flag file — allow
  if (!opts.flagFileExists) {
    return { decision: 'allow' };
  }

  // Flag file exists — check if this is a paw command
  if (opts.toolName === 'Bash') {
    const command = (opts.toolInput?.command as string) ?? '';
    if (/(?:^|&& |; )paw /.test(command)) {
      return { decision: 'allow' };
    }
  }

  // Deny with flag file contents as reason
  return { decision: 'deny', reason: opts.flagFileContents };
}

describe('inbox gate hook logic', () => {
  it('allows when no .paw/tasks/*.md exists (not a paw worktree)', () => {
    const result = simulateInboxGate({
      hasTaskFile: false,
      flagFileExists: false,
      toolName: 'Read',
    });
    expect(result.decision).toBe('allow');
  });

  it('allows when flag file is missing', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: false,
      toolName: 'Read',
    });
    expect(result.decision).toBe('allow');
  });

  it('denies non-paw Bash command when flag file present', () => {
    const reason =
      '⚠ You have 1 unanswered message(s).\n\n  (abc1) other-task → my-task: "What is the API shape?"';
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: reason,
      toolName: 'Bash',
      toolInput: { command: 'cat file.txt' },
    });
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe(reason);
  });

  it('allows paw reply command when flag file present', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: 'unanswered messages',
      toolName: 'Bash',
      toolInput: { command: 'paw reply api-task "Circle has kind, radius"' },
    });
    expect(result.decision).toBe('allow');
  });

  it('allows paw inbox command when flag file present', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: 'unanswered messages',
      toolName: 'Bash',
      toolInput: { command: 'paw inbox' },
    });
    expect(result.decision).toBe('allow');
  });

  it('allows paw command after cd && chain', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: 'unanswered messages',
      toolName: 'Bash',
      toolInput: { command: 'cd /tmp && paw reply api-task "done"' },
    });
    expect(result.decision).toBe('allow');
  });

  it('denies Bash command that contains paw as a substring but not as a command', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: 'unanswered messages',
      toolName: 'Bash',
      toolInput: { command: 'echo "paw reply" && cat secret.txt' },
    });
    expect(result.decision).toBe('deny');
  });

  it('denies Read tool when flag file present', () => {
    const result = simulateInboxGate({
      hasTaskFile: true,
      taskName: 'my-task',
      flagFileExists: true,
      flagFileContents: 'unanswered messages',
      toolName: 'Read',
    });
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('unanswered messages');
  });
});

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
