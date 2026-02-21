import { describe, it, expect } from 'vitest';
import { tmuxSessionName, cleanAgentEnv, isInsideTmux } from '../src/lib/tmux.js';

/**
 * Tests for the tmux-based launcher. The core TmuxService and launchTmux
 * tests live in tmux.test.ts. This file covers the launcher surface area
 * (session naming, env cleaning, tmux detection) for backward compatibility
 * with the test structure.
 */

describe('tmuxSessionName', () => {
  it('produces paw-prefixed session names', () => {
    expect(tmuxSessionName('myapp')).toBe('paw-myapp');
  });

  it('sanitizes non-alphanumeric chars', () => {
    expect(tmuxSessionName('my project')).toBe('paw-my-project');
    expect(tmuxSessionName('app_v2.3')).toBe('paw-app-v2-3');
  });
});

describe('cleanAgentEnv', () => {
  it('strips CLAUDECODE and CLAUDE_CODE_ENTRYPOINT', () => {
    const env = {
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      HOME: '/home/user',
    };
    const cleaned = cleanAgentEnv(env);
    expect(cleaned).not.toHaveProperty('CLAUDECODE');
    expect(cleaned).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
    expect(cleaned['PATH']).toBe('/usr/bin');
    expect(cleaned['HOME']).toBe('/home/user');
  });

  it('returns env unchanged when no agent vars present', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user' };
    const cleaned = cleanAgentEnv(env);
    expect(cleaned).toEqual(env);
  });
});

describe('isInsideTmux', () => {
  it('returns a boolean', () => {
    expect(typeof isInsideTmux()).toBe('boolean');
  });
});
