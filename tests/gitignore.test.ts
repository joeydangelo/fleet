import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

import { ensurePawGitignore, removePawFromRootGitignore } from '../src/lib/gitignore.js';
import { makeTempDir } from './helpers/temp.js';

describe('ensurePawGitignore', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.paw'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('creates .paw/.gitignore with expected entries and is idempotent', () => {
    const created = ensurePawGitignore(repoRoot);
    expect(created).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.paw', '.gitignore'), 'utf-8');
    expect(content).toContain('run/');
    expect(content).toContain('docs/');
    expect(content).toContain('tasks/');
    expect(content).toContain('sync/');
    expect(content).toContain('sessions/');
    expect(content).toContain('paw.yaml');
    expect(content).toContain('*.tmp');

    // Second call is idempotent — returns false, content unchanged
    const secondResult = ensurePawGitignore(repoRoot);
    expect(secondResult).toBe(false);
    const contentAfter = readFileSync(resolve(repoRoot, '.paw', '.gitignore'), 'utf-8');
    expect(contentAfter).toBe(content);
  });

  it('does not include manifest.yml, hooks/, or individual runtime files', () => {
    ensurePawGitignore(repoRoot);
    const content = readFileSync(resolve(repoRoot, '.paw', '.gitignore'), 'utf-8');
    expect(content).not.toContain('manifest.yml');
    expect(content).not.toContain('hooks/');
    // These moved into run/ — no longer need individual entries
    expect(content).not.toContain('state.yml');
    expect(content).not.toContain('panes.json');
  });

  it('updates if content differs', () => {
    writeFileSync(resolve(repoRoot, '.paw', '.gitignore'), 'old-content\n', 'utf-8');
    const updated = ensurePawGitignore(repoRoot);
    expect(updated).toBe(true);
    const content = readFileSync(resolve(repoRoot, '.paw', '.gitignore'), 'utf-8');
    expect(content).toContain('docs/');
  });
});

describe('removePawFromRootGitignore', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('removes .paw/ line and its comment from root .gitignore', () => {
    writeFileSync(
      resolve(repoRoot, '.gitignore'),
      'node_modules/\ndist/\n\n# paw working state\n.paw/\n',
      'utf-8',
    );
    const removed = removePawFromRootGitignore(repoRoot);
    expect(removed).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.paw/');
    expect(content).not.toContain('# paw working state');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
  });

  it('returns false when .gitignore does not exist', () => {
    const removed = removePawFromRootGitignore(repoRoot);
    expect(removed).toBe(false);
  });

  it('returns false when .paw/ is not present', () => {
    writeFileSync(resolve(repoRoot, '.gitignore'), 'node_modules/\n', 'utf-8');
    const removed = removePawFromRootGitignore(repoRoot);
    expect(removed).toBe(false);
  });

  it('removes .paw/ even without the comment', () => {
    writeFileSync(resolve(repoRoot, '.gitignore'), 'node_modules/\n.paw/\n', 'utf-8');
    const removed = removePawFromRootGitignore(repoRoot);
    expect(removed).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.paw/');
  });
});
