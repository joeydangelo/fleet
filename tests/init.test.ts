import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installHooks } from '../src/lib/hooks.js';
import { readDoc, parseFrontmatter } from '../src/lib/docs.js';
import { updatePawSection } from '../src/commands/init.js';
import { makeTempDir } from './helpers/temp.js';

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

    // SessionStart should have matcher group format: gh CLI + paw session + inbox
    const sessionStart = settings.hooks.SessionStart;
    expect(sessionStart).toHaveLength(3);
    expect(sessionStart[0]).toHaveProperty('matcher', '');
    expect(sessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/confirm-gh-cli.sh',
      timeout: 120,
    });
    expect(sessionStart[1]).toHaveProperty('matcher', '');
    expect(sessionStart[1].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh',
    });
    expect(sessionStart[2]).toHaveProperty('matcher', '');
    expect(sessionStart[2].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/hooks/paw-inbox.sh',
    });

    // UserPromptSubmit should have inbox check
    const userPrompt = settings.hooks.UserPromptSubmit;
    expect(userPrompt).toHaveLength(1);
    expect(userPrompt[0]).toHaveProperty('matcher', '');
    expect(userPrompt[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/hooks/paw-inbox.sh',
    });

    // PreCompact should call paw-session.sh --brief (prime embeds skill content)
    const preCompact = settings.hooks.PreCompact;
    expect(preCompact).toHaveLength(1);
    expect(preCompact[0]).toHaveProperty('matcher', '');
    expect(preCompact[0]).toHaveProperty('hooks');
    expect(preCompact[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/paw-session.sh --brief',
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
    expect(content).toContain('paw prime "$@"');
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

    // Should have tbd + gh CLI + paw session + paw inbox hooks
    expect(settings.hooks.SessionStart).toHaveLength(4);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('tbd');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('confirm-gh-cli');
    expect(settings.hooks.SessionStart[2].hooks[0].command).toContain('paw-session');
    expect(settings.hooks.SessionStart[3].hooks[0].command).toContain('paw-inbox');
  });

  it('registers PostToolUse hook for paw done reminder (paw-xlg3)', () => {
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );

    const postToolUse = settings.hooks.PostToolUse;
    expect(postToolUse).toHaveLength(2);
    expect(postToolUse[0]).toHaveProperty('matcher', 'Bash');
    expect(postToolUse[0].hooks[0].command).toContain('paw-done-reminder.sh');
    expect(postToolUse[1]).toHaveProperty('matcher', '');
    expect(postToolUse[1].hooks[0].command).toContain('paw-heartbeat.sh');
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
    expect(settings.hooks.SessionStart).toHaveLength(3);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(2);
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

    // Old flat format should be replaced with gh CLI + paw session + inbox
    expect(settings.hooks.SessionStart).toHaveLength(3);
    expect(settings.hooks.SessionStart[0]).toHaveProperty('matcher');
    expect(settings.hooks.SessionStart[0]).toHaveProperty('hooks');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('confirm-gh-cli');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('paw-session');
    expect(settings.hooks.SessionStart[2].hooks[0].command).toContain('paw-inbox');
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
    const marker = '<!-- DO NOT EDIT: Generated by paw init. Run paw init to update. -->';

    // Simulate init's marker insertion
    const installed = doc!.content.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1${marker}\n`);

    expect(installed).toContain(marker);
    expect(installed.startsWith('---')).toBe(true);
    // Marker should come after frontmatter
    const markerIndex = installed.indexOf(marker);
    expect(markerIndex).toBeGreaterThan(0);
  });
});

describe('updatePawSection — AGENTS.md markers', () => {
  it('replaces content between BEGIN/END markers, preserving content after', () => {
    const content = [
      '# My Project',
      '',
      '<!-- BEGIN PAW INTEGRATION -->',
      'old paw content here',
      '<!-- END PAW INTEGRATION -->',
      '',
      '## User Notes',
      'Important user content that must be preserved.',
    ].join('\n');

    const newSection = [
      '<!-- BEGIN PAW INTEGRATION -->',
      'new paw content',
      '<!-- END PAW INTEGRATION -->',
    ].join('\n');

    const result = updatePawSection(content, newSection);

    expect(result).toContain('# My Project');
    expect(result).toContain('new paw content');
    expect(result).toContain('## User Notes');
    expect(result).toContain('Important user content that must be preserved.');
    expect(result).not.toContain('old paw content here');
  });

  it('returns content unchanged when no markers are present', () => {
    const content = '# My Project\n\nSome content here.';
    const result = updatePawSection(content, 'new section');
    expect(result).toBe(content);
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

describe('paw init — AGENTS.md + dynamic directories', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    // paw init requires a git repo
    execFileSync('git', ['init', repoRoot], { stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('creates AGENTS.md with both BEGIN and END markers', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    execFileSync(process.execPath, [binPath, 'init'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const agentsPath = resolve(repoRoot, 'AGENTS.md');
    expect(existsSync(agentsPath)).toBe(true);

    const content = readFileSync(agentsPath, 'utf-8');
    expect(content).toContain('<!-- BEGIN PAW INTEGRATION -->');
    expect(content).toContain('<!-- END PAW INTEGRATION -->');
  });

  it('installed SKILL.md has shortcut directory with full paw shortcut <name> format', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    execFileSync(process.execPath, [binPath, 'init'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    const skillPath = resolve(repoRoot, '.claude', 'skills', 'paw', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf-8');
    // Verify shortcut directory exists with full command format
    expect(content).toContain('<!-- BEGIN SHORTCUT DIRECTORY -->');
    expect(content).toContain('<!-- END SHORTCUT DIRECTORY -->');
    expect(content).toMatch(/\| `paw shortcut \S+` \|/);
    // Verify guidelines directory uses full command format
    expect(content).toMatch(/\| `paw guidelines \S+` \|/);
  });
});
