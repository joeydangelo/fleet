import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';

import { ensureFleetGitignore, removeFleetFromRootGitignore } from '../src/lib/gitignore.js';
import { makeTempDir } from './helpers/temp.js';

describe('ensureFleetGitignore', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    mkdirSync(resolve(repoRoot, '.fleet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('creates .fleet/.gitignore with expected entries and is idempotent', () => {
    const created = ensureFleetGitignore(repoRoot);
    expect(created).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.fleet', '.gitignore'), 'utf-8');
    expect(content).toContain('run/');
    expect(content).toContain('docs/');
    expect(content).toContain('tasks/');
    expect(content).toContain('sync/');
    expect(content).toContain('sessions/');
    expect(content).toContain('fleet.yaml');
    expect(content).toContain('*.tmp');

    // Second call is idempotent — returns false, content unchanged
    const secondResult = ensureFleetGitignore(repoRoot);
    expect(secondResult).toBe(false);
    const contentAfter = readFileSync(resolve(repoRoot, '.fleet', '.gitignore'), 'utf-8');
    expect(contentAfter).toBe(content);
  });

  it('does not include manifest.yml, hooks/, or individual runtime files', () => {
    ensureFleetGitignore(repoRoot);
    const content = readFileSync(resolve(repoRoot, '.fleet', '.gitignore'), 'utf-8');
    expect(content).not.toContain('manifest.yml');
    expect(content).not.toContain('hooks/');
    // These moved into run/ — no longer need individual entries
    expect(content).not.toContain('state.yml');
    expect(content).not.toContain('panes.json');
  });

  it('updates if content differs', () => {
    writeFileSync(resolve(repoRoot, '.fleet', '.gitignore'), 'old-content\n', 'utf-8');
    const updated = ensureFleetGitignore(repoRoot);
    expect(updated).toBe(true);
    const content = readFileSync(resolve(repoRoot, '.fleet', '.gitignore'), 'utf-8');
    expect(content).toContain('docs/');
  });
});

describe('removeFleetFromRootGitignore', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('removes .fleet/ line and its comment from root .gitignore', () => {
    writeFileSync(
      resolve(repoRoot, '.gitignore'),
      'node_modules/\ndist/\n\n# fleet working state\n.fleet/\n',
      'utf-8',
    );
    const removed = removeFleetFromRootGitignore(repoRoot);
    expect(removed).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.fleet/');
    expect(content).not.toContain('# fleet working state');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
  });

  it('returns false when .gitignore does not exist', () => {
    const removed = removeFleetFromRootGitignore(repoRoot);
    expect(removed).toBe(false);
  });

  it('returns false when .fleet/ is not present', () => {
    writeFileSync(resolve(repoRoot, '.gitignore'), 'node_modules/\n', 'utf-8');
    const removed = removeFleetFromRootGitignore(repoRoot);
    expect(removed).toBe(false);
  });

  it('removes .fleet/ even without the comment', () => {
    writeFileSync(resolve(repoRoot, '.gitignore'), 'node_modules/\n.fleet/\n', 'utf-8');
    const removed = removeFleetFromRootGitignore(repoRoot);
    expect(removed).toBe(true);

    const content = readFileSync(resolve(repoRoot, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.fleet/');
  });
});
