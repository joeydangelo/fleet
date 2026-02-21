import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentName } from './tmux.js';

/** Per-agent search paths (after PATH lookup fails). */
const AGENT_PATHS: Record<AgentName, string[]> = {
  claude: [
    join(homedir(), '.claude', 'local', 'claude'),
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude',
    join(homedir(), 'bin', 'claude'),
  ],
  codex: [
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    join(homedir(), '.local', 'bin', 'codex'),
    join(homedir(), 'bin', 'codex'),
    join(homedir(), '.npm-global', 'bin', 'codex'),
  ],
  opencode: [
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    join(homedir(), '.local', 'bin', 'opencode'),
    join(homedir(), 'bin', 'opencode'),
  ],
  gemini: [
    '/usr/local/bin/gemini',
    '/opt/homebrew/bin/gemini',
    join(homedir(), '.local', 'bin', 'gemini'),
    join(homedir(), 'bin', 'gemini'),
  ],
};

/**
 * Check if a command exists in PATH using `which`.
 * Returns the resolved path or null.
 */
function whichCommand(name: string): string | null {
  try {
    return execFileSync('which', [name], { encoding: 'utf-8', stdio: 'pipe' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Find the path to an agent binary. Checks PATH first, then common
 * install directories.
 */
export function findAgent(name: AgentName): string | null {
  // Try PATH first
  const inPath = whichCommand(name);
  if (inPath) return inPath;

  // Check common install paths
  const paths = AGENT_PATHS[name];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** All supported agent names. */
export const SUPPORTED_AGENTS: readonly AgentName[] = [
  'claude',
  'codex',
  'opencode',
  'gemini',
] as const;

/**
 * Detect all installed agents by checking PATH and common install dirs.
 * Returns array of available agent names.
 */
export function getAvailableAgents(): AgentName[] {
  const available: AgentName[] = [];
  for (const name of SUPPORTED_AGENTS) {
    if (findAgent(name)) {
      available.push(name);
    }
  }
  return available;
}
