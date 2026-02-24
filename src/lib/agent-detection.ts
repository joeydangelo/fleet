import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AGENT_NAMES } from './tmux.js';
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
  const inPath = whichCommand(name);
  if (inPath) return inPath;

  const paths = AGENT_PATHS[name];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

export { AGENT_NAMES as SUPPORTED_AGENTS } from './tmux.js';

export function getAvailableAgents(): AgentName[] {
  const available: AgentName[] = [];
  for (const name of AGENT_NAMES) {
    if (findAgent(name)) {
      available.push(name);
    }
  }
  return available;
}
