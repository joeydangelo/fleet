import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createFixtureRepo, type FixtureRepo } from './fixture-repo.js';
import { getRepoRoot } from '../../src/lib/git.js';
import { resolveSyncDir, readSyncState } from '../../src/lib/sync.js';

let fixture: FixtureRepo | null = null;
let originalCwd: string;

afterEach(() => {
  if (originalCwd) process.chdir(originalCwd);
  fixture?.cleanup();
  fixture = null;
});

describe('createFixtureRepo', () => {
  it('creates a valid git repo with default auth task', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    expect(existsSync(fixture.repoRoot)).toBe(true);
    expect(existsSync(resolve(fixture.repoRoot, '.git'))).toBe(true);
    expect(existsSync(resolve(fixture.repoRoot, '.paw', 'paw.yaml'))).toBe(true);
    expect(existsSync(resolve(fixture.repoRoot, '.paw', 'tasks', 'auth.md'))).toBe(true);
  });

  it('getRepoRoot works when chdir to repoRoot', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();
    process.chdir(fixture.repoRoot);

    // git rev-parse and os.tmpdir may disagree on Windows 8.3 short names
    expect(basename(getRepoRoot())).toBe(basename(fixture.repoRoot));
  });

  it('resolveSyncDir returns the syncDir path', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    expect(resolveSyncDir(fixture.repoRoot)).toBe(fixture.syncDir);
  });

  it('syncDir contains state.json and review/ directory', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    expect(existsSync(resolve(fixture.syncDir, 'state.json'))).toBe(true);
    expect(existsSync(resolve(fixture.syncDir, 'review'))).toBe(true);
  });

  it('readSyncState returns the state written during setup', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    const state = readSyncState(fixture.repoRoot);
    expect(state).not.toBeNull();
    expect(state!.tasks).toHaveProperty('auth');
    expect(state!.tasks.auth!.status).toBe('in_progress');
    expect(state!.target).toBe('fix/test-target');
  });

  it('supports custom task names and definitions', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo({
      tasks: {
        api: { focus: 'src/api.ts' },
        web: { focus: 'src/web.ts' },
      },
    });

    expect(existsSync(resolve(fixture.repoRoot, '.paw', 'tasks', 'api.md'))).toBe(true);
    expect(existsSync(resolve(fixture.repoRoot, '.paw', 'tasks', 'web.md'))).toBe(true);
    expect(existsSync(resolve(fixture.repoRoot, '.paw', 'tasks', 'auth.md'))).toBe(false);

    const state = readSyncState(fixture.repoRoot);
    expect(state!.tasks).toHaveProperty('api');
    expect(state!.tasks).toHaveProperty('web');
  });

  it('supports custom initial sync state', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo({
      syncState: {
        tasks: {
          auth: { status: 'in_review', reviewCycle: 2 },
        },
      },
    });

    const state = readSyncState(fixture.repoRoot);
    expect(state!.tasks.auth!.status).toBe('in_review');
    expect(state!.tasks.auth!.reviewCycle).toBe(2);
  });

  it('writeSyncState updates state.json in sync worktree', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    const state = fixture.readSyncState()!;
    state.tasks.auth!.status = 'done';
    fixture.writeSyncState(state);

    const updated = readSyncState(fixture.repoRoot);
    expect(updated!.tasks.auth!.status).toBe('done');
  });

  it('readSyncFile reads files from sync worktree', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    const stateRaw = fixture.readSyncFile('state.json');
    expect(stateRaw).not.toBeNull();
    const parsed = JSON.parse(stateRaw!);
    expect(parsed.tasks).toHaveProperty('auth');
  });

  it('readSyncFile returns null for missing files', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();

    expect(fixture.readSyncFile('nonexistent.txt')).toBeNull();
  });

  it('cleanup removes temp directory', () => {
    originalCwd = process.cwd();
    fixture = createFixtureRepo();
    const root = fixture.repoRoot;

    fixture.cleanup();
    fixture = null; // prevent double cleanup in afterEach

    expect(existsSync(root)).toBe(false);
  });
});
