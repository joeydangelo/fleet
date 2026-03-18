import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installHooks } from './hooks.js';

/** Run the feed script with given JSON input and optional env vars. */
function runFeedScript(
  repoRoot: string,
  input: Record<string, unknown>,
  env: Record<string, string> = {},
): string | null {
  const scriptPath = resolve(repoRoot, '.claude/hooks/fleet-feed.sh');
  const feedPath = resolve(repoRoot, '.fleet/run/feed.ndjson');

  // Ensure feed dir exists
  mkdirSync(resolve(repoRoot, '.fleet/run'), { recursive: true });

  // Remove existing feed file to get clean output
  if (existsSync(feedPath)) rmSync(feedPath);

  try {
    execSync(`bash "${scriptPath}"`, {
      input: JSON.stringify(input),
      cwd: repoRoot,
      env: { ...process.env, ...env, HOME: process.env.HOME ?? '/tmp' },
      timeout: 5000,
    });
  } catch {
    // Script may exit 0 with no output on skip
  }

  if (existsSync(feedPath)) {
    return readFileSync(feedPath, 'utf-8').trim();
  }
  return null;
}

function parseFeedLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

describe('FLEET_FEED_SCRIPT (PostToolUse hook)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = resolve(
      tmpdir(),
      `fleet-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(repoRoot, { recursive: true });

    // Create a task file so task detection works
    mkdirSync(resolve(repoRoot, '.fleet/tasks'), { recursive: true });
    writeFileSync(resolve(repoRoot, '.fleet/tasks/alpha.md'), '# Task: alpha\n');

    // Install hooks to get the script file
    installHooks(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('emits tool.Read with file field', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Read',
      tool_input: { file_path: 'src/auth/middleware.ts' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Read');
    expect(event.file).toBe('src/auth/middleware.ts');
    expect(event.task).toBe('alpha');
    expect(event.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('emits tool.Glob with pattern and hits', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Glob',
      tool_input: { pattern: '**/*.ts' },
      tool_output: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Glob');
    expect(event.pattern).toBe('**/*.ts');
  });

  it('emits tool.Grep with pattern and hits', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Grep',
      tool_input: { pattern: 'validateSession' },
      tool_output: 'file1.ts\nfile2.ts',
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Grep');
    expect(event.pattern).toBe('validateSession');
  });

  it('emits tool.Edit with file and lines', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Edit',
      tool_input: { file_path: 'src/auth/middleware.ts', new_string: 'line1\nline2\nline3' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Edit');
    expect(event.file).toBe('src/auth/middleware.ts');
    expect(event.lines).toBe(3);
  });

  it('emits tool.Write with file', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Write',
      tool_input: { file_path: 'src/new-file.ts' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Write');
    expect(event.file).toBe('src/new-file.ts');
  });

  it('emits tool.Agent with description', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Agent',
      tool_input: { description: 'security specialist' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Agent');
    expect(event.description).toBe('security specialist');
  });

  it('emits tool.Bash with cmd for regular bash commands', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: 'npm test -- --filter auth' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('tool.Bash');
    expect(event.cmd).toBe('npm test -- --filter auth');
  });

  it('skips emission for fleet commands', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: 'fleet broadcast "Starting alpha"' },
    });

    expect(output).toBeNull();
  });

  it('emits git.commit with msg for git commit commands', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "fix bug"' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('git.commit');
    expect(event.msg).toBe('fix bug');
  });

  it('emits git.commit with msg from single-quoted message', () => {
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: "git commit -m 'fix(auth): validate session'" },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.event).toBe('git.commit');
    expect(event.msg).toBe('fix(auth): validate session');
  });

  it('truncates git commit msg to 50 chars', () => {
    const longMsg = 'a'.repeat(80);
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: `git commit -m "${longMsg}"` },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.msg).toBe('a'.repeat(50));
  });

  it('truncates Bash cmd to 120 chars', () => {
    const longCmd = 'echo ' + 'x'.repeat(200);
    const output = runFeedScript(repoRoot, {
      tool_name: 'Bash',
      tool_input: { command: longCmd },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect((event.cmd as string).length).toBe(120);
  });

  it('uses task:reviewer when FLEET_ROLE=reviewer', () => {
    const output = runFeedScript(
      repoRoot,
      {
        tool_name: 'Read',
        tool_input: { file_path: 'src/auth/middleware.ts' },
      },
      { FLEET_ROLE: 'reviewer' },
    );

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.task).toBe('alpha:reviewer');
  });

  it('defaults task to orchestrator when no task file exists', () => {
    // Remove task file
    rmSync(resolve(repoRoot, '.fleet/tasks'), { recursive: true, force: true });

    const output = runFeedScript(repoRoot, {
      tool_name: 'Read',
      tool_input: { file_path: 'src/something.ts' },
    });

    expect(output).not.toBeNull();
    const event = parseFeedLine(output!);
    expect(event.task).toBe('orchestrator');
  });
});

describe('installHooks registers feed hook', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = resolve(tmpdir(), `fleet-hook-install-test-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes fleet-feed.sh script file', () => {
    installHooks(repoRoot);
    expect(existsSync(resolve(repoRoot, '.claude/hooks/fleet-feed.sh'))).toBe(true);
  });

  it('registers PostToolUse hook with empty matcher for feed', () => {
    installHooks(repoRoot);
    const settings = JSON.parse(readFileSync(resolve(repoRoot, '.claude/settings.json'), 'utf-8'));
    const postToolUse = settings.hooks.PostToolUse as Array<{
      matcher: string;
      hooks: Array<{ command: string }>;
    }>;
    const feedEntry = postToolUse.find((g) =>
      g.hooks?.some((h) => h.command.includes('fleet-feed')),
    );
    expect(feedEntry).toBeDefined();
    expect(feedEntry!.matcher).toBe('');
  });
});
