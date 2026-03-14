import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { PawConfig } from '../src/lib/config.js';
import {
  planWorktrees,
  generateTaskFile,
  writeTaskFiles,
  ensureGitignore,
  detectTaskName,
  copyIncludes,
  runSetup,
} from '../src/lib/session.js';
import { makeTempDir } from './helpers/temp.js';

const baseConfig: PawConfig = {
  base: 'main',
  target: 'feature/dashboard',
  tasks: {
    auth: { focus: 'src/auth/' },
    api: { focus: ['src/api/', 'src/routes/'] },
  },
};

describe('planWorktrees', () => {
  it('computes sibling worktree paths from repo root', () => {
    const result = planWorktrees(baseConfig, '/projects/acme-app');

    expect(result).toHaveLength(2);
    expect(result[0]?.worktreePath).toBe(resolve('/projects', 'acme-app-paw-auth'));
    expect(result[1]?.worktreePath).toBe(resolve('/projects', 'acme-app-paw-api'));
  });

  it('computes branch names as target/taskName', () => {
    const result = planWorktrees(baseConfig, '/projects/acme-app');

    expect(result[0]?.branch).toBe('feature/dashboard-auth');
    expect(result[1]?.branch).toBe('feature/dashboard-api');
  });

  it('preserves task names', () => {
    const result = planWorktrees(baseConfig, '/projects/acme-app');

    expect(result.map((w) => w.taskName)).toEqual(['auth', 'api']);
  });
});

describe('generateTaskFile', () => {
  it('produces expected markdown with single-string focus', () => {
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(baseConfig, worktree);

    expect(result).toContain('# Task: auth');
    expect(result).toContain('**Branch:** feature/dashboard-auth');
    expect(result).toContain('**Target:** feature/dashboard');
    expect(result).toContain('**Worktree:** /projects/acme-app-paw-auth');
    expect(result).toContain('- src/auth/');
  });

  it('handles array focus', () => {
    const worktree = {
      taskName: 'api',
      branch: 'feature/dashboard-api',
      worktreePath: '/projects/acme-app-paw-api',
    };

    const result = generateTaskFile(baseConfig, worktree);

    expect(result).toContain('- src/api/');
    expect(result).toContain('- src/routes/');
  });

  it('includes instructions when prompt is set, omits when absent', () => {
    const configWithPrompt: PawConfig = {
      ...baseConfig,
      tasks: {
        auth: { focus: 'src/auth/', prompt: 'Implement OAuth2 login.' },
      },
    };
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const withPrompt = generateTaskFile(configWithPrompt, worktree);
    expect(withPrompt).toContain('## Instructions');
    expect(withPrompt).toContain('Implement OAuth2 login.');

    const withoutPrompt = generateTaskFile(baseConfig, worktree);
    expect(withoutPrompt).not.toContain('## Instructions');
  });

  it('includes issue in header when issue field is set', () => {
    const config: PawConfig = {
      ...baseConfig,
      tasks: {
        auth: { focus: 'src/auth/', issue: 'GH#123' },
      },
    };
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(config, worktree);

    expect(result).toContain('**Issue:** GH#123');
  });

  it('omits issue line when issue field is not set', () => {
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(baseConfig, worktree);

    expect(result).not.toContain('**Issue:**');
  });

  it('includes spec path in header when top-level spec is set', () => {
    const config: PawConfig = {
      ...baseConfig,
      spec: '.paw/specs/spec-2026-03-04-auth.md',
    };
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(config, worktree);

    expect(result).toContain('**Spec:** .paw/specs/spec-2026-03-04-auth.md');
  });

  it('omits spec line when no spec is set', () => {
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(baseConfig, worktree);

    expect(result).not.toContain('**Spec:**');
  });

  it('includes depends_on in header when depends_on is a string', () => {
    const config: PawConfig = {
      ...baseConfig,
      tasks: {
        auth: { focus: 'src/auth/' },
        api: { focus: 'src/api/', depends_on: 'auth' },
      },
    };
    const worktree = {
      taskName: 'api',
      branch: 'feature/dashboard-api',
      worktreePath: '/projects/acme-app-paw-api',
    };

    const result = generateTaskFile(config, worktree);

    expect(result).toContain('**Depends on:** auth');
  });

  it('includes depends_on in header when depends_on is an array', () => {
    const config: PawConfig = {
      ...baseConfig,
      tasks: {
        auth: { focus: 'src/auth/' },
        api: { focus: 'src/api/' },
        tests: { focus: 'tests/', depends_on: ['auth', 'api'] },
      },
    };
    const worktree = {
      taskName: 'tests',
      branch: 'feature/dashboard-tests',
      worktreePath: '/projects/acme-app-paw-tests',
    };

    const result = generateTaskFile(config, worktree);

    expect(result).toContain('**Depends on:** auth, api');
  });

  it('omits depends_on line when not set', () => {
    const worktree = {
      taskName: 'auth',
      branch: 'feature/dashboard-auth',
      worktreePath: '/projects/acme-app-paw-auth',
    };

    const result = generateTaskFile(baseConfig, worktree);

    expect(result).not.toContain('**Depends on:**');
  });

  it('throws on unknown task name', () => {
    const worktree = {
      taskName: 'nope',
      branch: 'feature/dashboard-nope',
      worktreePath: '/projects/acme-app-paw-nope',
    };

    expect(() => generateTaskFile(baseConfig, worktree)).toThrow('Task not found: nope');
  });
});

describe('writeTaskFiles', () => {
  it('creates .paw/tasks/<name>.md in each worktree dir', () => {
    const dir = makeTempDir();
    const wt1 = resolve(dir, 'wt-auth');
    const wt2 = resolve(dir, 'wt-api');
    mkdirSync(wt1, { recursive: true });
    mkdirSync(wt2, { recursive: true });

    const worktrees = [
      { taskName: 'auth', branch: 'feature/dashboard-auth', worktreePath: wt1 },
      { taskName: 'api', branch: 'feature/dashboard-api', worktreePath: wt2 },
    ];

    writeTaskFiles(baseConfig, worktrees);

    const authFile = resolve(wt1, '.paw', 'tasks', 'auth.md');
    const apiFile = resolve(wt2, '.paw', 'tasks', 'api.md');

    expect(existsSync(authFile)).toBe(true);
    expect(existsSync(apiFile)).toBe(true);

    const authContent = readFileSync(authFile, 'utf-8');
    expect(authContent).toContain('# Task: auth');

    const apiContent = readFileSync(apiFile, 'utf-8');
    expect(apiContent).toContain('# Task: api');
    expect(apiContent).toContain('- src/api/');
    expect(apiContent).toContain('- src/routes/');

    rmSync(dir, { recursive: true });
  });

  it('adds .paw/ to .gitignore in each worktree', () => {
    const dir = makeTempDir();
    const wt = resolve(dir, 'wt-auth');
    mkdirSync(wt, { recursive: true });

    const worktrees = [{ taskName: 'auth', branch: 'feature/dashboard-auth', worktreePath: wt }];

    writeTaskFiles(baseConfig, worktrees);

    const gitignore = readFileSync(resolve(wt, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.paw/');

    rmSync(dir, { recursive: true });
  });
});

describe('detectTaskName', () => {
  it('finds task name from single file in .paw/tasks/', () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, '.paw', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, 'auth.md'), '# Task: auth\n');

    expect(detectTaskName(dir)).toBe('auth');

    rmSync(dir, { recursive: true });
  });

  it('returns null when .paw/tasks/ does not exist', () => {
    const dir = makeTempDir();

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });

  it('returns null when .paw/tasks/ has multiple files', () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, '.paw', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, 'auth.md'), '# auth\n');
    writeFileSync(resolve(tasksDir, 'api.md'), '# api\n');

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });

  it('returns null when .paw/tasks/ is empty', () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, '.paw', 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });
});

describe('ensureGitignore', () => {
  it('creates .gitignore with .paw/ when none exists', () => {
    const dir = makeTempDir();

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, '.gitignore'), 'utf-8');
    expect(content).toBe('.paw/\n');

    rmSync(dir, { recursive: true });
  });

  it('appends .paw/ to existing .gitignore', () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, '.gitignore'), 'node_modules/\ndist/\n');

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.paw/');
  });

  it('does not duplicate .paw/ if already present', () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, '.gitignore'), 'node_modules/\n.paw/\n');

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, '.gitignore'), 'utf-8');
    const matches = content.match(/\.paw\//g);
    expect(matches).toHaveLength(1);

    rmSync(dir, { recursive: true });
  });
});

describe('ensureGitignore with baseBranch (paw-numd)', () => {
  let repoDir: string;

  function gitInit(dir: string): void {
    execFileSync('git', ['init', dir], { stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
      cwd: dir,
      stdio: 'pipe',
    });
  }

  function commitFile(dir: string, filename: string, content: string, message: string): void {
    writeFileSync(resolve(dir, filename), content);
    execFileSync('git', ['add', filename], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', message], {
      cwd: dir,
      stdio: 'pipe',
    });
  }

  afterEach(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  it('skips adding .paw/ when base branch already has it', () => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    commitFile(repoDir, '.gitignore', 'node_modules/\n.paw/\n', 'add gitignore');

    // Create a feature branch (simulating a worktree branch)
    execFileSync('git', ['checkout', '-b', 'feature-branch'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    // Remove .paw/ locally to simulate it not being in the local file
    writeFileSync(resolve(repoDir, '.gitignore'), 'node_modules/\n');

    ensureGitignore(repoDir, 'main');

    // Should NOT have added .paw/ because base branch has it
    const content = readFileSync(resolve(repoDir, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.paw/');
  });

  it('adds .paw/ when base branch does not have it', () => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    commitFile(repoDir, '.gitignore', 'node_modules/\n', 'add gitignore');

    execFileSync('git', ['checkout', '-b', 'feature-branch'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    ensureGitignore(repoDir, 'main');

    const content = readFileSync(resolve(repoDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.paw/');
  });

  it('adds .paw/ when base branch has no .gitignore at all', () => {
    repoDir = makeTempDir();
    gitInit(repoDir);

    execFileSync('git', ['checkout', '-b', 'feature-branch'], {
      cwd: repoDir,
      stdio: 'pipe',
    });

    ensureGitignore(repoDir, 'main');

    const content = readFileSync(resolve(repoDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.paw/');
  });

  it('falls back to local check when no baseBranch provided', () => {
    repoDir = makeTempDir();
    gitInit(repoDir);

    // No baseBranch -- original behavior
    ensureGitignore(repoDir);

    const content = readFileSync(resolve(repoDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.paw/\n');
  });
});

describe('runSetup', () => {
  it('runs command in the specified directory', () => {
    const dir = makeTempDir();

    runSetup(dir, 'echo hello > output.txt');

    expect(readFileSync(resolve(dir, 'output.txt'), 'utf-8').trim()).toBe('hello');

    rmSync(dir, { recursive: true });
  });

  it('verifies command runs in the specified working directory', () => {
    const dir = makeTempDir();

    runSetup(dir, 'pwd > cwd-output.txt');

    const output = readFileSync(resolve(dir, 'cwd-output.txt'), 'utf-8').trim().toLowerCase();
    // Normalize both paths: pwd on Windows/Git Bash returns /c/... while Node
    // returns C:\... — lowercase and strip drive-letter prefix differences
    const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
    // Strip leading drive letter format difference: "/c/" vs "C:/"
    const stripDrive = (p: string) =>
      p.replace(/^\/([a-z])\//, '$1:/').replace(/^([a-z]):\//, '$1:/');
    expect(stripDrive(output)).toBe(stripDrive(normalizedDir));

    rmSync(dir, { recursive: true });
  });

  it('throws on non-zero exit code', () => {
    const dir = makeTempDir();

    expect(() => runSetup(dir, 'exit 1')).toThrow();

    rmSync(dir, { recursive: true });
  });
});

describe('copyIncludes', () => {
  it('copies files matching literal patterns', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    writeFileSync(resolve(repoRoot, '.env'), 'SECRET=abc');

    const copied = await copyIncludes(repoRoot, worktree, ['.env']);

    expect(readFileSync(resolve(worktree, '.env'), 'utf-8')).toBe('SECRET=abc');
    expect(copied).toEqual(['.env']);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });

  it('creates parent directories as needed', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    mkdirSync(resolve(repoRoot, 'config'), { recursive: true });
    writeFileSync(resolve(repoRoot, 'config', 'local.json'), '{}');

    const copied = await copyIncludes(repoRoot, worktree, ['config/local.json']);

    expect(readFileSync(resolve(worktree, 'config', 'local.json'), 'utf-8')).toBe('{}');
    expect(copied).toEqual(['config/local.json']);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });

  it('skips files that already exist in worktree', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    writeFileSync(resolve(repoRoot, '.env'), 'NEW=value');
    writeFileSync(resolve(worktree, '.env'), 'OLD=value');

    const copied = await copyIncludes(repoRoot, worktree, ['.env']);

    // Should not overwrite
    expect(readFileSync(resolve(worktree, '.env'), 'utf-8')).toBe('OLD=value');
    expect(copied).toEqual([]);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });

  it('resolves glob patterns', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    writeFileSync(resolve(repoRoot, '.env'), 'A=1');
    writeFileSync(resolve(repoRoot, '.env.local'), 'B=2');
    writeFileSync(resolve(repoRoot, '.env.test'), 'C=3');

    const copied = await copyIncludes(repoRoot, worktree, ['.env*']);

    expect(copied.sort()).toEqual(['.env', '.env.local', '.env.test']);
    expect(existsSync(resolve(worktree, '.env'))).toBe(true);
    expect(existsSync(resolve(worktree, '.env.local'))).toBe(true);
    expect(existsSync(resolve(worktree, '.env.test'))).toBe(true);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });

  it('returns empty array when no patterns match', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    const copied = await copyIncludes(repoRoot, worktree, ['nonexistent.*']);

    expect(copied).toEqual([]);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });

  it('handles multiple patterns', async () => {
    const repoRoot = makeTempDir();
    const worktree = makeTempDir();

    writeFileSync(resolve(repoRoot, '.env'), 'A=1');
    mkdirSync(resolve(repoRoot, 'config'), { recursive: true });
    writeFileSync(resolve(repoRoot, 'config', 'local.json'), '{}');

    const copied = await copyIncludes(repoRoot, worktree, ['.env', 'config/local.json']);

    expect(copied.sort()).toEqual(['.env', 'config/local.json']);

    rmSync(repoRoot, { recursive: true });
    rmSync(worktree, { recursive: true });
  });
});
