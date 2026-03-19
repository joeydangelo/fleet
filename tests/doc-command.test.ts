import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

// Mock external boundary: URL fetching — no network calls in tests
vi.mock('../src/lib/github-fetch.js', () => ({
  githubBlobToRawUrl: (url: string) =>
    url.replace('/blob/', '/').replace('github.com', 'raw.githubusercontent.com'),
  fetchWithGhFallback: vi.fn(),
}));

// Mock git so getRepoRoot() returns our temp dir (no actual git required)
vi.mock('../src/lib/git.js', async (importOriginal) => {
  return { ...(await importOriginal()), getRepoRoot: vi.fn(), getRepoRootOrNull: vi.fn() };
});

// Mock ensureDocsFresh to be a no-op — it calls git and network; irrelevant here
vi.mock('../src/lib/doc-sync.js', () => ({
  ensureDocsFresh: vi.fn().mockResolvedValue(undefined),
}));

import { fetchWithGhFallback } from '../src/lib/github-fetch.js';
import { getRepoRoot } from '../src/lib/git.js';
import { createDocCommand } from '../src/commands/doc-command.js';
import { makeTempDir } from './helpers/temp.js';

const mockedFetch = vi.mocked(fetchWithGhFallback);
const mockedGetRepoRoot = vi.mocked(getRepoRoot);

/** Parse string args and run the command, capturing stdout/stderr. */
async function runCommand(
  args: string[],
  repoRoot: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const logs: string[] = [];
  const errs: string[] = [];
  let exitCode: number | null = null;

  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origExit = process.exit.bind(process);

  console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => errs.push(a.map(String).join(' '));
  console.warn = (...a: unknown[]) => errs.push(a.map(String).join(' '));
  // Capture exit code instead of actually exiting
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;

  mockedGetRepoRoot.mockReturnValue(repoRoot);

  const cmd = createDocCommand('shortcut', 'shortcuts', 'Show a shortcut doc');

  try {
    await cmd.parseAsync(['node', 'shortcut', ...args]);
  } catch (err) {
    // Only swallow the synthetic exit error; re-throw real errors
    if (!(err instanceof Error && err.message.startsWith('process.exit('))) {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      process.exit = origExit;
      throw err;
    }
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    process.exit = origExit;
  }

  return { stdout: logs.join('\n'), stderr: errs.join('\n'), exitCode };
}

describe('createDocCommand', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mockedFetch.mockReset();
    vi.stubEnv('FLEET_REPO_ROOT', repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  // ── 1. Default path: name lookup reads and displays doc content ──────────
  it('displays doc content when a known name is provided', async () => {
    const docsDir = resolve(repoRoot, '.fleet', 'docs', 'shortcuts');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      resolve(docsDir, 'build-task.md'),
      '---\nname: build-task\ndescription: How to build a task\n---\n# Build Task\nDo the work.',
      'utf-8',
    );

    const { stdout, exitCode } = await runCommand(['build-task'], repoRoot);

    expect(exitCode).toBeNull();
    expect(stdout).toContain('# Build Task');
    expect(stdout).toContain('Do the work.');
  });

  // ── 2. --list path: lists available docs without error ───────────────────
  it('lists available docs when --list is passed', async () => {
    const docsDir = resolve(repoRoot, '.fleet', 'docs', 'shortcuts');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(
      resolve(docsDir, 'alpha.md'),
      '---\nname: alpha\ndescription: First shortcut\n---\n# Alpha',
      'utf-8',
    );
    writeFileSync(
      resolve(docsDir, 'beta.md'),
      '---\nname: beta\ndescription: Second shortcut\n---\n# Beta',
      'utf-8',
    );

    const { stdout, exitCode } = await runCommand(['--list'], repoRoot);

    expect(exitCode).toBeNull();
    expect(stdout).toContain('alpha');
    expect(stdout).toContain('beta');
  });

  it('shows empty message when --list finds no docs', async () => {
    mkdirSync(resolve(repoRoot, '.fleet', 'docs', 'shortcuts'), { recursive: true });

    const { stdout, exitCode } = await runCommand(['--list'], repoRoot);

    expect(exitCode).toBeNull();
    expect(stdout).toContain('No shortcuts found');
  });

  // ── 3. --add path: addDoc is called with correct args and file is created ─
  it('creates the doc file at the correct path when --add is used', async () => {
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });

    mockedFetch.mockResolvedValue({
      content: '---\nname: my-shortcut\ndescription: A new one\n---\n# My Shortcut\nContent.',
      usedGhCli: false,
    });

    const { exitCode } = await runCommand(
      ['--add', 'https://example.com/my-shortcut.md', '--name', 'my-shortcut'],
      repoRoot,
    );

    expect(exitCode).toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith('https://example.com/my-shortcut.md');

    const destFile = resolve(repoRoot, '.fleet', 'docs', 'shortcuts', 'my-shortcut.md');
    expect(existsSync(destFile)).toBe(true);
  });

  it('derives doc name from URL when --name is not given', async () => {
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });

    mockedFetch.mockResolvedValue({
      content: '# Derived\nContent here.',
      usedGhCli: false,
    });

    await runCommand(['--add', 'https://example.com/derived-name.md'], repoRoot);

    const destFile = resolve(repoRoot, '.fleet', 'docs', 'shortcuts', 'derived-name.md');
    expect(existsSync(destFile)).toBe(true);
  });

  it('injects roles into frontmatter when --roles is supplied with --add', async () => {
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });

    mockedFetch.mockResolvedValue({
      content: '---\nname: role-doc\ndescription: Roles test\n---\n# Role Doc',
      usedGhCli: false,
    });

    await runCommand(
      [
        '--add',
        'https://example.com/role-doc.md',
        '--name',
        'role-doc',
        '--roles',
        'builder,reviewer',
      ],
      repoRoot,
    );

    const { readFileSync } = await import('node:fs');
    const content = readFileSync(
      resolve(repoRoot, '.fleet', 'docs', 'shortcuts', 'role-doc.md'),
      'utf-8',
    );
    expect(content).toContain('roles: [builder, reviewer]');
  });

  // ── 4. Error path: doc not found exits gracefully ────────────────────────
  it('exits with code 1 when the named doc does not exist', async () => {
    mkdirSync(resolve(repoRoot, '.fleet', 'docs', 'shortcuts'), { recursive: true });

    const { exitCode, stderr } = await runCommand(['nonexistent-doc'], repoRoot);

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });
});
