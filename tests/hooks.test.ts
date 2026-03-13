import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { installHooks } from '../src/lib/hooks.js';
import { makeTempDir } from './helpers/temp.js';

describe('installHooks', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('warns when settings.json is corrupted and overwrites with defaults', () => {
    const settingsDir = resolve(repoRoot, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(resolve(settingsDir, 'settings.json'), 'NOT VALID JSON{{{');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    installHooks(repoRoot);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Corrupted settings.json'));

    // Settings should be valid JSON after overwrite
    const settings = JSON.parse(readFileSync(resolve(settingsDir, 'settings.json'), 'utf-8'));
    expect(settings.hooks).toBeDefined();
  });

  it('does not warn when settings.json is valid', () => {
    const settingsDir = resolve(repoRoot, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(resolve(settingsDir, 'settings.json'), '{}');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    installHooks(repoRoot);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
