import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installHooks, PAW_SESSION_SCRIPT } from '../src/lib/hooks.js';
import { readDoc } from '../src/lib/docs.js';

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('installHooks', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('creates correct hook schema with matcher groups', () => {
    installHooks(repoRoot);

    const settingsPath = resolve(repoRoot, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // SessionStart should have matcher group format
    const sessionStart = settings.hooks.SessionStart;
    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0]).toHaveProperty('matcher', '');
    expect(sessionStart[0]).toHaveProperty('hooks');
    expect(sessionStart[0].hooks).toHaveLength(1);
    expect(sessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh',
    });

    // PreCompact should have the same format with --brief
    const preCompact = settings.hooks.PreCompact;
    expect(preCompact).toHaveLength(1);
    expect(preCompact[0]).toHaveProperty('matcher', '');
    expect(preCompact[0]).toHaveProperty('hooks');
    expect(preCompact[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh --brief',
    });
  });

  it('writes the wrapper script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'scripts', 'paw-session.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('paw prime');
    expect(content).toContain('npm');
  });

  it('preserves existing non-paw hooks', () => {
    const settingsDir = resolve(repoRoot, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      resolve(settingsDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: 'bash .claude/scripts/tbd-session.sh',
                },
              ],
            },
          ],
        },
      }),
    );

    installHooks(repoRoot);

    const settings = JSON.parse(readFileSync(resolve(settingsDir, 'settings.json'), 'utf-8'));

    // Should have both tbd and paw hooks
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('tbd');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('paw');
  });

  it('registers PostToolUse hook for paw done reminder (paw-xlg3)', () => {
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );

    const postToolUse = settings.hooks.PostToolUse;
    expect(postToolUse).toHaveLength(1);
    expect(postToolUse[0]).toHaveProperty('matcher', 'Bash');
    expect(postToolUse[0].hooks[0].command).toContain('paw-done-reminder.sh');
  });

  it('writes the paw done reminder script (paw-xlg3)', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'hooks', 'paw-done-reminder.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('paw done');
    expect(content).toContain('paw-sync:summaries');
  });

  it('is idempotent -- does not duplicate paw hooks', () => {
    installHooks(repoRoot);
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it('replaces old flat-format paw hooks with correct schema', () => {
    const settingsDir = resolve(repoRoot, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      resolve(settingsDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ command: 'paw prime --brief' }],
          PreCompact: [{ command: 'paw prime --brief' }],
        },
      }),
    );

    installHooks(repoRoot);

    const settings = JSON.parse(readFileSync(resolve(settingsDir, 'settings.json'), 'utf-8'));

    // Old flat format should be replaced, not appended
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0]).toHaveProperty('matcher');
    expect(settings.hooks.SessionStart[0]).toHaveProperty('hooks');
  });
});

describe('SKILL.md bundling (paw-m5d5)', () => {
  it('skill template is available via readDoc', () => {
    const doc = readDoc('templates', 'skill');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('# paw');
    expect(doc!.content).toContain('paw prime');
    expect(doc!.content).toContain('paw broadcast');
  });

  it('skill template has valid frontmatter', () => {
    const doc = readDoc('templates', 'skill');
    expect(doc!.content).toMatch(/^---\n/);
    expect(doc!.content).toContain('description:');
    expect(doc!.content).toContain('globs:');
  });

  it('installed skill file includes DO NOT EDIT marker after frontmatter', () => {
    const doc = readDoc('templates', 'skill');
    const marker = '<!-- DO NOT EDIT: Generated by paw setup. Run paw setup to update. -->';

    // Simulate setup's marker insertion
    const installed = doc!.content.replace(/^(---\n[\s\S]*?\n---\n)/, `$1${marker}\n`);

    expect(installed).toContain(marker);
    expect(installed.startsWith('---')).toBe(true);
    // Marker should come after frontmatter, before content
    const markerIndex = installed.indexOf(marker);
    const contentIndex = installed.indexOf('# paw');
    expect(markerIndex).toBeLessThan(contentIndex);
  });
});

describe('PAW_SESSION_SCRIPT', () => {
  it('contains PATH resolution logic', () => {
    expect(PAW_SESSION_SCRIPT).toContain('NPM_GLOBAL_BIN');
    expect(PAW_SESSION_SCRIPT).toContain('export PATH');
  });

  it('ensures paw is available', () => {
    expect(PAW_SESSION_SCRIPT).toContain('ensure_paw');
    expect(PAW_SESSION_SCRIPT).toContain('command -v paw');
  });

  it('passes arguments through to paw prime', () => {
    expect(PAW_SESSION_SCRIPT).toContain('paw prime "$@"');
  });
});
