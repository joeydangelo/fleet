import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installHooks } from '../src/lib/hooks.js';
import { readDoc, parseFrontmatter } from '../src/lib/docs.js';

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

    // SessionStart should have matcher group format: gh CLI + paw session
    const sessionStart = settings.hooks.SessionStart;
    expect(sessionStart).toHaveLength(2);
    expect(sessionStart[0]).toHaveProperty('matcher', '');
    expect(sessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/confirm-gh-cli.sh',
      timeout: 120,
    });
    expect(sessionStart[1]).toHaveProperty('matcher', '');
    expect(sessionStart[1].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh prime',
    });

    // PreCompact should call paw skill --brief (not paw prime --brief)
    const preCompact = settings.hooks.PreCompact;
    expect(preCompact).toHaveLength(1);
    expect(preCompact[0]).toHaveProperty('matcher', '');
    expect(preCompact[0]).toHaveProperty('hooks');
    expect(preCompact[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh skill --brief',
    });
  });

  it('writes the confirm-gh-cli script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'scripts', 'confirm-gh-cli.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('command -v gh');
    expect(content).toContain('gh auth status');
  });

  it('writes the wrapper script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'scripts', 'paw-session.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('paw "$@"');
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

    // Should have tbd + gh CLI + paw session hooks
    expect(settings.hooks.SessionStart).toHaveLength(3);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('tbd');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('confirm-gh-cli');
    expect(settings.hooks.SessionStart[2].hooks[0].command).toContain('paw-session');
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
    expect(settings.hooks.SessionStart).toHaveLength(2);
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

    // Old flat format should be replaced with gh CLI + paw session
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0]).toHaveProperty('matcher');
    expect(settings.hooks.SessionStart[0]).toHaveProperty('hooks');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('confirm-gh-cli');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('paw-session');
  });
});

describe('SKILL.md bundling (paw-m5d5)', () => {
  it('skill template is available via readDoc', () => {
    const doc = readDoc('templates', 'skill');
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain('name: paw');
    expect(doc!.content).toContain('allowed-tools: Bash(paw:*)');
  });

  it('skill template has valid frontmatter', () => {
    const doc = readDoc('templates', 'skill');
    expect(doc!.content).toMatch(/^---\r?\n/);
    expect(doc!.content).toContain('description:');
    expect(doc!.content).toContain('globs:');
  });

  it('installed skill file includes DO NOT EDIT marker after frontmatter', () => {
    const doc = readDoc('templates', 'skill');
    const marker = '<!-- DO NOT EDIT: Generated by paw setup. Run paw setup to update. -->';

    // Simulate setup's marker insertion
    const installed = doc!.content.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1${marker}\n`);

    expect(installed).toContain(marker);
    expect(installed.startsWith('---')).toBe(true);
    // Marker should come after frontmatter
    const markerIndex = installed.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(0);
  });
});

describe('parseFrontmatter', () => {
  it('extracts title and description from YAML frontmatter', () => {
    const content = '---\ntitle: My Title\ndescription: My description\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('My Title');
    expect(result.description).toBe('My description');
  });

  it('returns empty object when no frontmatter is present', () => {
    const content = '# No frontmatter here';
    const result = parseFrontmatter(content);
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('handles frontmatter with only title', () => {
    const content = '---\ntitle: Only Title\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('Only Title');
    expect(result.description).toBeUndefined();
  });

  it('handles values with colons and special characters', () => {
    const content = '---\ntitle: "Rules: A Guide"\ndescription: Use @clack/prompts for UI\n---\n';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('Rules: A Guide');
    expect(result.description).toBe('Use @clack/prompts for UI');
  });
});
