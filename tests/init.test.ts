import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installHooks } from '../src/lib/hooks.js';
import { parseFrontmatter } from '../src/lib/docs.js';
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

    // SessionStart should have matcher group format: fleet session + skill inject
    const sessionStart = settings.hooks.SessionStart;
    expect(sessionStart).toHaveLength(2);
    expect(sessionStart[0]).toHaveProperty('matcher', '');
    expect(sessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/fleet-session.sh',
    });
    expect(sessionStart[1]).toHaveProperty('matcher', '');
    expect(sessionStart[1].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/fleet-skill-inject.sh',
    });

    // UserPromptSubmit should have inbox check
    const userPrompt = settings.hooks.UserPromptSubmit;
    expect(userPrompt).toHaveLength(1);
    expect(userPrompt[0]).toHaveProperty('matcher', '');
    expect(userPrompt[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/hooks/fleet-inbox.sh',
    });

    // PreCompact should call fleet-session.sh --brief (prime embeds skill content)
    const preCompact = settings.hooks.PreCompact;
    expect(preCompact).toHaveLength(1);
    expect(preCompact[0]).toHaveProperty('matcher', '');
    expect(preCompact[0]).toHaveProperty('hooks');
    expect(preCompact[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash .claude/scripts/fleet-session.sh --brief',
    });
  });

  it('writes the wrapper script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'scripts', 'fleet-session.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('fleet prime "$@"');
    expect(content).toContain('npm');
  });

  it('writes the skill-inject script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'scripts', 'fleet-skill-inject.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('FLEET_ROLE');
    expect(content).toContain('SKILL_FILE');
  });

  it('preserves existing non-fleet hooks', () => {
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
                  command: 'bash .claude/scripts/custom-session.sh',
                },
              ],
            },
          ],
        },
      }),
    );

    installHooks(repoRoot);

    const settings = JSON.parse(readFileSync(resolve(settingsDir, 'settings.json'), 'utf-8'));

    // Should have custom + fleet session + skill inject hooks
    expect(settings.hooks.SessionStart).toHaveLength(3);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('custom-session');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('fleet-session');
    expect(settings.hooks.SessionStart[2].hooks[0].command).toContain('fleet-skill-inject');
  });

  it('registers PostToolUse hook for fleet review reminder (fleet-xlg3)', () => {
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );

    const postToolUse = settings.hooks.PostToolUse;
    expect(postToolUse).toHaveLength(2);
    expect(postToolUse[0]).toHaveProperty('matcher', 'Bash');
    expect(postToolUse[0].hooks[0].command).toContain('fleet-review-reminder.sh');
    expect(postToolUse[1]).toHaveProperty('matcher', '');
    expect(postToolUse[1].hooks[0].command).toContain('fleet-heartbeat.sh');
  });

  it('writes the fleet review reminder script', () => {
    installHooks(repoRoot);

    const scriptPath = resolve(repoRoot, '.claude', 'hooks', 'fleet-review-reminder.sh');
    expect(existsSync(scriptPath)).toBe(true);

    const content = readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('fleet review');
    expect(content).toContain('fleet-sync:state.json');
  });

  it('is idempotent -- does not duplicate fleet hooks', () => {
    installHooks(repoRoot);
    installHooks(repoRoot);

    const settings = JSON.parse(
      readFileSync(resolve(repoRoot, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.PreCompact).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(2);
  });

  it('replaces old flat-format fleet hooks with correct schema', () => {
    const settingsDir = resolve(repoRoot, '.claude');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      resolve(settingsDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ command: 'fleet prime --brief' }],
          PreCompact: [{ command: 'fleet prime --brief' }],
        },
      }),
    );

    installHooks(repoRoot);

    const settings = JSON.parse(readFileSync(resolve(settingsDir, 'settings.json'), 'utf-8'));

    // Old flat format should be replaced with fleet session + skill inject
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0]).toHaveProperty('matcher');
    expect(settings.hooks.SessionStart[0]).toHaveProperty('hooks');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('fleet-session');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('fleet-skill-inject');
  });
});

describe('role-specific skill sources', () => {
  const roles = ['orchestrator', 'builder', 'reviewer'];

  for (const role of roles) {
    it(`${role} skill source exists and has valid frontmatter`, () => {
      const skillPath = resolve(process.cwd(), 'skills', role, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);

      const content = readFileSync(skillPath, 'utf-8');
      expect(content).toMatch(/^---\r?\n/);
      expect(content).toContain(`name: ${role}`);
      expect(content).toContain('allowed-tools: Bash(fleet:*)');
    });
  }
});

describe('parseFrontmatter', () => {
  it('extracts name and description from YAML frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: My description\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('my-skill');
    expect(result.description).toBe('My description');
  });

  it('returns empty object when no frontmatter is present', () => {
    const content = '# No frontmatter here';
    const result = parseFrontmatter(content);
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('handles frontmatter with only name', () => {
    const content = '---\nname: only-name\n---\n# Body';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('only-name');
    expect(result.description).toBeUndefined();
  });

  it('handles values with colons and special characters', () => {
    const content = '---\nname: "rules-guide"\ndescription: Use @clack/prompts for UI\n---\n';
    const result = parseFrontmatter(content);
    expect(result.title).toBe('rules-guide');
    expect(result.description).toBe('Use @clack/prompts for UI');
  });

  it('extracts roles array from frontmatter', () => {
    const content = '---\nname: test\ndescription: A test\nroles: [builder, reviewer]\n---\n';
    const result = parseFrontmatter(content);
    expect(result.roles).toEqual(['builder', 'reviewer']);
  });

  it('returns undefined roles when field is absent', () => {
    const content = '---\nname: test\ndescription: A test\n---\n';
    const result = parseFrontmatter(content);
    expect(result.roles).toBeUndefined();
  });
});

describe('fleet init — role-specific skills with filtered directories', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = makeTempDir();
    execFileSync('git', ['init', repoRoot], { stdio: 'pipe' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('installs three role-specific skills with injected directories', () => {
    const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');
    execFileSync(process.execPath, [binPath, 'init'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    for (const role of ['orchestrator', 'builder', 'reviewer']) {
      const skillPath = resolve(repoRoot, '.claude', 'skills', role, 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);

      const content = readFileSync(skillPath, 'utf-8');
      expect(content).toContain(`name: ${role}`);
      expect(content).toContain('<!-- BEGIN SHORTCUT DIRECTORY -->');
      expect(content).toMatch(/\| `fleet shortcut \S+` \|/);
    }

    // Builder skill should have guidelines, orchestrator should not
    const builderContent = readFileSync(
      resolve(repoRoot, '.claude', 'skills', 'builder', 'SKILL.md'),
      'utf-8',
    );
    expect(builderContent).toContain('<!-- BEGIN GUIDELINES DIRECTORY -->');
    expect(builderContent).toMatch(/\| `fleet guidelines \S+` \|/);

    // Old monolithic skill should not exist
    expect(existsSync(resolve(repoRoot, '.claude', 'skills', 'fleet', 'SKILL.md'))).toBe(false);
  });
});
