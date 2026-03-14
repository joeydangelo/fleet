import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTempDir } from './helpers/temp.js';
import { getWorktreeProgress } from '../src/lib/worktree-stats.js';

function gitIn(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('getWorktreeProgress', () => {
  let repoDir: string;
  const target = 'main';
  const featureBranch = 'feature/work';

  beforeEach(() => {
    repoDir = makeTempDir();

    gitIn(repoDir, ['init', '-b', target]);
    gitIn(repoDir, ['config', 'user.email', 'test@test.com']);
    gitIn(repoDir, ['config', 'user.name', 'Test']);

    // Initial commit on main (the target branch)
    writeFileSync(resolve(repoDir, 'README.md'), 'hello\n');
    gitIn(repoDir, ['add', 'README.md']);
    gitIn(repoDir, ['commit', '-m', 'initial commit']);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns non-zero commits and files when branch has changes ahead of target', () => {
    // Create a feature branch with a new commit
    gitIn(repoDir, ['checkout', '-b', featureBranch]);
    writeFileSync(resolve(repoDir, 'feature.ts'), 'export const x = 1;\n');
    gitIn(repoDir, ['add', 'feature.ts']);
    gitIn(repoDir, ['commit', '-m', 'add feature']);

    const result = getWorktreeProgress(featureBranch, target, repoDir);

    expect(result.commits).toBeGreaterThan(0);
    expect(result.files).toBeGreaterThan(0);
  });

  it('returns commits=0 and files=0 when branch has no changes ahead of target', () => {
    // Feature branch at the same point as target — no diverging commits
    gitIn(repoDir, ['checkout', '-b', featureBranch]);

    const result = getWorktreeProgress(featureBranch, target, repoDir);

    expect(result.commits).toBe(0);
    expect(result.files).toBe(0);
  });
});
