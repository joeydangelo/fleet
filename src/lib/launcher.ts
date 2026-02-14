import { execFileSync, execSync } from 'node:child_process';

export type Platform = 'windows' | 'macos' | 'linux';

const LINUX_TERMINALS = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm', 'tmux'] as const;

export type LinuxTerminal = (typeof LINUX_TERMINALS)[number];

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

export function detectLinuxTerminal(): LinuxTerminal | null {
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
 * returns immediately after launching.
 */
export function spawnTerminal(opts: LaunchOptions, platform?: Platform): void {
  const plat = platform ?? detectPlatform();
  const env = cleanAgentEnv();

  if (plat === 'windows') {
    // On Windows, `start` is a cmd.exe builtin. Using execFileSync with an
    // args array applies C-runtime quoting (backslash-escaped quotes) which
    // cmd.exe doesn't understand. Use execSync with a string command instead.
    const { worktreePath, agentCommand } = opts;
    execSync(`start "" /d "${worktreePath}" cmd /k ${agentCommand}`, {
      stdio: 'ignore',
      env,
    });
    return;
  }

  const { command, args } = buildLaunchCommand(opts, plat);
  execFileSync(command, args, { stdio: 'ignore', env });
}
