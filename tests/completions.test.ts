import { describe, it, expect } from 'vitest';
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from '../src/lib/completions.js';

describe('generateBashCompletion', () => {
  it('produces a bash completion script', () => {
    const script = generateBashCompletion();

    expect(script).toContain('_paw_completions()');
    expect(script).toContain('complete -F _paw_completions paw');
  });

  it('includes all subcommands', () => {
    const script = generateBashCompletion();

    for (const cmd of ['setup', 'up', 'prime', 'status', 'done', 'merge', 'down', 'completions']) {
      expect(script).toContain(cmd);
    }
  });

  it('handles --pick completion via paw.yaml lookup', () => {
    const script = generateBashCompletion();

    expect(script).toContain('--pick');
    expect(script).toContain('paw.yaml');
  });
});

describe('generateZshCompletion', () => {
  it('produces a zsh completion script', () => {
    const script = generateZshCompletion();

    expect(script).toContain('#compdef paw');
    expect(script).toContain('_paw');
  });

  it('includes subcommands', () => {
    const script = generateZshCompletion();

    for (const cmd of ['setup', 'up', 'prime', 'status', 'done', 'merge', 'down']) {
      expect(script).toContain(cmd);
    }
  });
});

describe('generateFishCompletion', () => {
  it('produces a fish completion script', () => {
    const script = generateFishCompletion();

    expect(script).toContain('complete -c paw');
  });

  it('includes subcommands', () => {
    const script = generateFishCompletion();

    for (const cmd of ['setup', 'up', 'prime', 'status', 'done', 'merge', 'down']) {
      expect(script).toContain(cmd);
    }
  });
});
