import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Mock child_process and fs before importing the module
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { findAgent, getAvailableAgents, SUPPORTED_AGENTS } from '../src/lib/agent-detection.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no commands found, no files exist
  mockExecFileSync.mockImplementation(() => {
    throw new Error('not found');
  });
  mockExistsSync.mockReturnValue(false);
});

describe('SUPPORTED_AGENTS', () => {
  it('includes all four agents', () => {
    expect(SUPPORTED_AGENTS).toEqual(['claude', 'codex', 'opencode', 'gemini']);
  });
});

describe('findAgent', () => {
  it('returns path from which when agent is in PATH', () => {
    mockExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
    const result = findAgent('claude');
    expect(result).toBe('/usr/local/bin/claude');
    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['claude'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  });

  it('falls back to common paths when which fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExistsSync.mockImplementation((p) => {
      return p === '/usr/local/bin/claude';
    });

    const result = findAgent('claude');
    expect(result).toBe('/usr/local/bin/claude');
  });

  it('returns null when agent is not found anywhere', () => {
    const result = findAgent('claude');
    expect(result).toBeNull();
  });

  it('checks claude-specific paths', () => {
    mockExistsSync.mockImplementation((p) => {
      return p === join(homedir(), '.claude', 'local', 'claude');
    });
    const result = findAgent('claude');
    expect(result).toBe(join(homedir(), '.claude', 'local', 'claude'));
  });

  it('checks codex-specific paths', () => {
    mockExistsSync.mockImplementation((p) => {
      return p === join(homedir(), '.npm-global', 'bin', 'codex');
    });
    const result = findAgent('codex');
    expect(result).toBe(join(homedir(), '.npm-global', 'bin', 'codex'));
  });

  it('checks opencode-specific paths', () => {
    mockExistsSync.mockImplementation((p) => {
      return p === '/opt/homebrew/bin/opencode';
    });
    const result = findAgent('opencode');
    expect(result).toBe('/opt/homebrew/bin/opencode');
  });

  it('checks gemini-specific paths', () => {
    mockExistsSync.mockImplementation((p) => {
      return p === '/usr/local/bin/gemini';
    });
    const result = findAgent('gemini');
    expect(result).toBe('/usr/local/bin/gemini');
  });

  it('returns first matching path from common paths', () => {
    mockExistsSync.mockImplementation((p) => {
      // Both exist, but first in the list should be returned
      return p === join(homedir(), '.local', 'bin', 'claude') || p === '/usr/local/bin/claude';
    });
    const result = findAgent('claude');
    // .claude/local/claude doesn't exist, but .local/bin/claude does (second in list)
    expect(result).toBe(join(homedir(), '.local', 'bin', 'claude'));
  });
});

describe('getAvailableAgents', () => {
  it('returns empty array when no agents are installed', () => {
    expect(getAvailableAgents()).toEqual([]);
  });

  it('returns only installed agents', () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const name = (args as string[])[0];
      if (name === 'claude') return '/usr/local/bin/claude\n';
      if (name === 'gemini') return '/usr/local/bin/gemini\n';
      throw new Error('not found');
    });
    expect(getAvailableAgents()).toEqual(['claude', 'gemini']);
  });

  it('returns all agents when all are installed', () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const name = (args as string[])[0];
      return `/usr/local/bin/${name}\n`;
    });
    expect(getAvailableAgents()).toEqual(['claude', 'codex', 'opencode', 'gemini']);
  });
});
