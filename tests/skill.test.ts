import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const binPath = resolve(process.cwd(), 'dist', 'bin.mjs');

describe('paw skill', () => {
  it('outputs skill body containing # paw', () => {
    const result = execFileSync(process.execPath, [binPath, 'skill'], {
      stdio: 'pipe',
    });
    const stdout = result.toString();
    expect(stdout).toContain('# paw');
  });

  it('does not include YAML frontmatter in output', () => {
    const result = execFileSync(process.execPath, [binPath, 'skill'], {
      stdio: 'pipe',
    });
    const stdout = result.toString();
    expect(stdout).not.toMatch(/^---\r?\n/);
    expect(stdout).not.toContain('allowed-tools:');
    expect(stdout).not.toContain('globs:');
  });

  it('--brief outputs content from skill-brief.md', () => {
    const result = execFileSync(process.execPath, [binPath, 'skill', '--brief'], {
      stdio: 'pipe',
    });
    const stdout = result.toString();
    expect(stdout).toContain('paw orchestrates parallel AI coding agents');
    expect(stdout).toContain('Orchestrator Commands');
  });

  it('--brief output is shorter than full output', () => {
    const full = execFileSync(process.execPath, [binPath, 'skill'], {
      stdio: 'pipe',
    }).toString();
    const brief = execFileSync(process.execPath, [binPath, 'skill', '--brief'], {
      stdio: 'pipe',
    }).toString();
    expect(brief.length).toBeLessThan(full.length);
  });
});
