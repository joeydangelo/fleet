import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type Platform = 'windows' | 'macos' | 'linux';

const LINUX_TERMINALS = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm', 'tmux'] as const;

type LinuxTerminal = (typeof LINUX_TERMINALS)[number];

export function detectPlatform(): Platform {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function detectLinuxTerminal(): LinuxTerminal | null {
  for (const term of LINUX_TERMINALS) {
    if (commandExists(term)) return term;
  }
  return null;
}

export interface LaunchOptions {
  worktreePath: string;
  agentCommand: string;
  terminal?: string;
}

export interface LaunchResult {
  command: string;
  args: string[];
}

/**
 * Build the command and args to open a new terminal window running the agent
 * command in the given worktree directory. Does not execute anything — the
 * caller decides whether to run it or just print it (--dry-run).
 */
export function buildLaunchCommand(opts: LaunchOptions, platform?: Platform): LaunchResult {
  const plat = platform ?? detectPlatform();
  const { worktreePath, agentCommand, terminal } = opts;

  switch (plat) {
    case 'windows':
      // Use start /d to set working directory directly. The empty "" is the
      // window title (required by start when the next arg is quoted).
      return {
        command: 'cmd',
        args: ['/c', `start "" /d "${worktreePath}" cmd /k ${agentCommand}`],
      };

    case 'macos':
      return {
        command: 'osascript',
        args: ['-e', `tell app "Terminal" to do script "cd '${worktreePath}' && ${agentCommand}"`],
      };

    case 'linux': {
      const term = terminal ?? detectLinuxTerminal();
      if (!term) {
        throw new Error(
          'No supported terminal emulator found. Install one of: ' +
            LINUX_TERMINALS.join(', ') +
            ', or use --terminal <emulator>.',
        );
      }

      return buildLinuxCommand(term, worktreePath, agentCommand);
    }
  }
}

/** Dispatches across 5 known terminals (gnome, konsole, xfce4, xterm, tmux) with per-emulator flag patterns; unknown terminals fall back to `-- bash -c`. */
function buildLinuxCommand(
  terminal: string,
  worktreePath: string,
  agentCommand: string,
): LaunchResult {
  const innerCmd = `cd '${worktreePath}' && ${agentCommand}`;

  switch (terminal) {
    case 'gnome-terminal':
      return {
        command: 'gnome-terminal',
        args: ['--', 'bash', '-c', innerCmd],
      };
    case 'konsole':
      return {
        command: 'konsole',
        args: ['-e', 'bash', '-c', innerCmd],
      };
    case 'xfce4-terminal':
      return {
        command: 'xfce4-terminal',
        args: ['-e', `bash -c "${innerCmd}"`],
      };
    case 'xterm':
      return {
        command: 'xterm',
        args: ['-e', `bash -c "${innerCmd}"`],
      };
    case 'tmux':
      return {
        command: 'tmux',
        args: ['new-window', '-c', worktreePath, agentCommand],
      };
    default:
      // User-provided terminal via --terminal flag: assume it takes -- bash -c
      return {
        command: terminal,
        args: ['--', 'bash', '-c', innerCmd],
      };
  }
}

/**
 * Build a clean environment for spawned terminals by stripping env vars
 * that prevent agent CLIs from starting (e.g., Claude Code sets CLAUDECODE
 * and CLAUDE_CODE_ENTRYPOINT — child terminals that inherit these refuse
 * to launch).
 */
export function cleanAgentEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const cleaned = { ...env };
  delete cleaned.CLAUDECODE;
  delete cleaned.CLAUDE_CODE_ENTRYPOINT;
  return cleaned;
}

/**
 * Spawn a terminal window running the agent command. Fire-and-forget —
 * returns immediately after launching. Returns the PID of the spawned
 * process (if available) so callers can track and kill it later.
 */
export function spawnTerminal(opts: LaunchOptions, platform?: Platform): number | undefined {
  const plat = platform ?? detectPlatform();
  const env = cleanAgentEnv();

  if (plat === 'windows') {
    // spawn with detached: true opens a new console window on Windows.
    // This gives us the real terminal PID so paw down can close it.
    const { worktreePath, agentCommand } = opts;
    const child = spawn('cmd', ['/k', agentCommand], {
      cwd: worktreePath,
      stdio: 'ignore',
      detached: true,
      env,
      windowsVerbatimArguments: true,
    });
    const pid = child.pid;
    child.unref();
    return pid;
  }

  const { command, args } = buildLaunchCommand(opts, plat);
  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    env,
  });
  const pid = child.pid;
  child.unref();
  return pid;
}

/** Task-name-to-PID mapping persisted by launch, consumed by down. */
type PidMap = Record<string, number>;

const PIDS_FILE = 'pids.json';

function pidsPath(repoRoot: string): string {
  return resolve(repoRoot, '.paw', PIDS_FILE);
}

/** Returns empty map if pids.json is missing or corrupt. */
export function readPidFile(repoRoot: string): PidMap {
  const p = pidsPath(repoRoot);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PidMap;
  } catch {
    return {};
  }
}

export function writePidFile(repoRoot: string, pids: PidMap): void {
  const dir = resolve(repoRoot, '.paw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(pidsPath(repoRoot), JSON.stringify(pids, null, 2) + '\n');
}

/** Idempotent — no error if file is already missing. */
export function removePidFile(repoRoot: string): void {
  const p = pidsPath(repoRoot);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // already removed
    }
  }
}

/**
 * Kill all tracked processes from pids.json. Returns the count of
 * processes that were successfully killed. Already-exited processes
 * are silently ignored.
 */
export function killTrackedProcesses(repoRoot: string, platform?: Platform): number {
  const pids = readPidFile(repoRoot);
  const plat = platform ?? detectPlatform();
  let killed = 0;

  for (const [, pid] of Object.entries(pids)) {
    try {
      if (plat === 'windows') {
        // Kill the process tree — the tracked PID is the cmd.exe parent
        execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      killed++;
    } catch {
      // Process already exited (ESRCH) or permission denied -- ignore
    }
  }

  removePidFile(repoRoot);
  return killed;
}
