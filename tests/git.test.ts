import { describe, it, expect, vi, afterEach } from 'vitest';
import { git } from '../src/lib/git.js';

describe('SHOW_COMMANDS debug logging', () => {
  afterEach(() => {
    delete process.env.SHOW_COMMANDS;
    vi.restoreAllMocks();
  });

  it('logs cmd and args to stderr when SHOW_COMMANDS=1', () => {
    process.env.SHOW_COMMANDS = '1';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // rev-parse is a safe, fast git command available in any repo
    git(['rev-parse', '--git-dir']);

    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('git');
    expect(output).toContain('rev-parse');
    expect(output).toContain('--git-dir');
  });

  it('does not log when SHOW_COMMANDS is not set', () => {
    delete process.env.SHOW_COMMANDS;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    git(['rev-parse', '--git-dir']);

    expect(spy).not.toHaveBeenCalled();
  });
});
