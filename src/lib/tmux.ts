import { execFileSync } from 'node:child_process';

/** Agent environment variables that prevent child agents from starting. */
const AGENT_ENV_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'] as const;

export type AgentName = 'claude' | 'codex' | 'opencode' | 'gemini';

/** Per-pane metadata persisted to .paw/panes.json. */
export interface PawPane {
  /** Unique pane identifier (paw-1, paw-2, ...). */
  id: string;
  /** tmux pane ID (%nn). */
  paneId: string;
  /** Task name from paw.yaml. */
  taskName: string;
  /** Original prompt / task description. */
  prompt: string;
  /** Full path to the git worktree. */
  worktreePath: string;
  /** Agent type running in this pane. */
  agent: AgentName;
  /** Git branch name. */
  branchName: string;
}

/** Persisted session state. */
export interface PawPaneConfig {
  /** tmux session name. */
  sessionName: string;
  /** Repo root path. */
  projectRoot: string;
  /** Active panes. */
  panes: PawPane[];
  /** ISO timestamp of last update. */
  lastUpdated: string;
}

/**
 * Interface for tmux operations. Enables dependency injection for testing.
 */
export interface TmuxServiceApi {
  sessionExists(name: string): boolean;
  createSession(name: string, cwd: string): void;
  killSession(name: string): void;
  createPane(sessionName: string, cwd: string): string;
  killPane(paneId: string): void;
  listPanes(sessionName: string): string[];
  paneExists(paneId: string): boolean;
  sendKeys(paneId: string, keys: string): void;
  capturePane(paneId: string, lines?: number): string;
  selectLayout(sessionName: string, layout: string): void;
  setPaneTitle(paneId: string, title: string): void;
  listClients(): string[];
  hasAttachedClient(sessionName: string): boolean;
  switchClient(sessionName: string): void;
  attachSession(sessionName: string): void;
}

/**
 * Execute a tmux command via execFileSync. Centralizes all tmux CLI calls.
 */
function execTmux(
  args: string[],
  opts?: { encoding?: BufferEncoding; stdio?: 'pipe' | 'ignore' },
): string {
  const encoding = opts?.encoding ?? 'utf-8';
  const stdio = opts?.stdio ?? 'pipe';
  return execFileSync('tmux', args, { encoding, stdio }).trim();
}

/**
 * TmuxService: all tmux CLI operations go through this class.
 * No platform detection, no WSL bridge. Assumes tmux is available.
 */
export class TmuxService implements TmuxServiceApi {
  private readonly exec: typeof execTmux;

  constructor(execFn?: typeof execTmux) {
    this.exec = execFn ?? execTmux;
  }

  sessionExists(name: string): boolean {
    try {
      this.exec(['has-session', '-t', name], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  createSession(name: string, cwd: string): void {
    this.exec(['new-session', '-d', '-s', name, '-c', cwd]);
  }

  killSession(name: string): void {
    this.exec(['kill-session', '-t', name]);
  }

  /** Split a new pane in the session. Returns the new pane ID (%nn). */
  createPane(sessionName: string, cwd: string): string {
    return this.exec(['split-window', '-t', sessionName, '-c', cwd, '-P', '-F', '#{pane_id}']);
  }

  killPane(paneId: string): void {
    this.exec(['kill-pane', '-t', paneId]);
  }

  /** List all pane IDs (%nn) in a session. */
  listPanes(sessionName: string): string[] {
    const output = this.exec(['list-panes', '-t', sessionName, '-F', '#{pane_id}']);
    return output.split('\n').filter(Boolean);
  }

  paneExists(paneId: string): boolean {
    try {
      this.exec(['display-message', '-t', paneId, '-p', '']);
      return true;
    } catch {
      return false;
    }
  }

  sendKeys(paneId: string, keys: string): void {
    this.exec(['send-keys', '-t', paneId, keys, 'Enter']);
  }

  capturePane(paneId: string, lines?: number): string {
    const args = ['capture-pane', '-t', paneId, '-p'];
    if (lines !== undefined) {
      args.push('-S', `-${lines}`);
    }
    return this.exec(args);
  }

  selectLayout(sessionName: string, layout: string): void {
    this.exec(['select-layout', '-t', sessionName, layout]);
  }

  setPaneTitle(paneId: string, title: string): void {
    this.exec(['select-pane', '-t', paneId, '-T', title]);
  }

  listClients(): string[] {
    const output = this.exec(['list-clients', '-F', '#{client_name}']);
    return output.split('\n').filter(Boolean);
  }

  hasAttachedClient(sessionName: string): boolean {
    try {
      const output = this.exec(['list-clients', '-t', sessionName, '-F', '#{client_name}']);
      return output.split('\n').filter(Boolean).length > 0;
    } catch {
      return false;
    }
  }

  switchClient(sessionName: string): void {
    this.exec(['switch-client', '-t', sessionName]);
  }

  attachSession(sessionName: string): void {
    // attach-session blocks until the user detaches
    execFileSync('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit',
    });
  }
}

/**
 * Sanitize a directory name into a valid tmux session name.
 * Replace non-alphanumeric chars with hyphens, collapse consecutive,
 * strip leading/trailing hyphens.
 */
export function tmuxSessionName(dirname: string): string {
  return `paw-${dirname
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * Build a clean environment for spawned agents by stripping env vars
 * that prevent agent CLIs from starting (e.g., Claude Code sets CLAUDECODE
 * and CLAUDE_CODE_ENTRYPOINT).
 */
export function cleanAgentEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const cleaned = { ...env };
  for (const key of AGENT_ENV_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}

/** Check if running inside a tmux session. */
export function isInsideTmux(): boolean {
  return !!process.env['TMUX'];
}

/**
 * Attach to a tmux session. Uses switch-client when already inside tmux,
 * otherwise attach-session (blocks until detach).
 */
export function attachToTmuxSession(tmux: TmuxServiceApi, sessionName: string): void {
  if (isInsideTmux()) {
    tmux.switchClient(sessionName);
  } else {
    tmux.attachSession(sessionName);
  }
}

/**
 * Launch agents in tmux panes for the given worktrees.
 * Creates the tmux session if it doesn't exist, then creates a pane
 * per worktree and sends the agent command.
 */
export function launchTmux(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  worktrees: Array<{ taskName: string; worktreePath: string; agentCommand: string }>,
): PawPane[] {
  if (!tmux.sessionExists(sessionName)) {
    tmux.createSession(sessionName, repoRoot);
  }

  const panes: PawPane[] = [];
  let paneIndex = 1;

  for (const wt of worktrees) {
    const paneId = tmux.createPane(sessionName, wt.worktreePath);
    const pane: PawPane = {
      id: `paw-${paneIndex}`,
      paneId,
      taskName: wt.taskName,
      prompt: wt.agentCommand,
      worktreePath: wt.worktreePath,
      agent: 'claude' as AgentName,
      branchName: '',
    };

    tmux.setPaneTitle(paneId, `paw-${wt.taskName}`);
    tmux.sendKeys(paneId, wt.agentCommand);

    panes.push(pane);
    paneIndex++;
  }

  tmux.selectLayout(sessionName, 'tiled');

  return panes;
}

/** Create a default TmuxService instance. */
export function createTmuxService(): TmuxService {
  return new TmuxService();
}
