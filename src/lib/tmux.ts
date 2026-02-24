import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type AgentName = 'claude' | 'codex' | 'opencode' | 'gemini';

export const AGENT_NAMES: readonly AgentName[] = ['claude', 'codex', 'opencode', 'gemini'] as const;

/** Lightweight snapshot of a tmux pane returned by listPanesDetailed. */
export interface TmuxPaneInfo {
  /** tmux pane ID (%nn). */
  paneId: string;
  /** Pane title (pane_title). May be stomped by apps like Claude Code. */
  title: string;
  /** Foreground command currently running in the pane (e.g. bash, claude). */
  command: string;
  /** Live working directory from #{pane_current_path}. */
  cwd: string;
  /** Project root from @paw_project custom option. Empty string if not set. */
  project: string;
}

/** Per-pane metadata persisted to .paw/panes.json. */
export interface PawPane {
  /** Unique pane identifier (paw-1, paw-2, ...). */
  id: string;
  /** tmux pane ID (%nn). */
  paneId: string;
  /** Task name from paw.yaml. */
  taskName: string;
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
  /**
   * Pane ID of the orchestrator shell (pane 1). Empty string if not yet created.
   * The orchestrator is where the user types their AI agent command (claude, codex, etc.).
   */
  orchestratorPaneId: string;
  /** Active agent panes (panes 2+). */
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
  createPane(sessionName: string, cwd: string, opts?: { horizontal?: boolean }): string;
  killPane(paneId: string): void;
  listPanes(sessionName: string): string[];
  listPanesDetailed(sessionName: string): TmuxPaneInfo[];
  listPanesWithTitles(sessionName: string): Map<string, string>;
  paneExists(paneId: string): boolean;
  sendKeys(paneId: string, keys: string): void;
  capturePane(paneId: string, lines?: number): string;
  selectLayout(sessionName: string, layout: string): void;
  selectPane(paneId: string): void;
  setPaneTitle(paneId: string, title: string): void;
  /** Sets a permanent paw role label via a custom tmux user option (@paw_role). */
  setPaneRole(paneId: string, role: string): void;
  /** Sets the project root on a pane via @paw_project custom user option. */
  setPaneProject(paneId: string, projectRoot: string): void;
  getCurrentPaneId(): string;
  getCurrentSessionName(): string;
  getPaneCurrentCommand(paneId: string): string;
  resizePane(paneId: string, width: number): void;
  pinSidebarLayout(sessionName: string, width: number): void;
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

  /**
   * Split a new pane in the session. Returns the new pane ID (%nn).
   * Pass `horizontal: true` for a left/right split (sidebar stays left).
   */
  createPane(sessionName: string, cwd: string, opts?: { horizontal?: boolean }): string {
    const args = ['split-window', '-t', sessionName, '-c', cwd, '-P', '-F', '#{pane_id}'];
    if (opts?.horizontal) args.push('-h');
    return this.exec(args);
  }

  killPane(paneId: string): void {
    this.exec(['kill-pane', '-t', paneId]);
  }

  /** List all pane IDs (%nn) in a session. */
  listPanes(sessionName: string): string[] {
    const output = this.exec(['list-panes', '-s', '-t', sessionName, '-F', '#{pane_id}']);
    return output.split('\n').filter(Boolean);
  }

  /** List all panes in a session with their ID, title, command, cwd, and project. */
  listPanesDetailed(sessionName: string): TmuxPaneInfo[] {
    const output = this.exec([
      'list-panes',
      '-s',
      '-t',
      sessionName,
      '-F',
      '#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}\t#{@paw_project}',
    ]);
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [paneId = '', title = '', command = '', cwd = '', project = ''] = line.split('\t');
        return { paneId, title, command, cwd, project };
      });
  }

  /** List panes with their titles. Returns a map of title -> pane ID. */
  listPanesWithTitles(sessionName: string): Map<string, string> {
    const output = this.exec([
      'list-panes',
      '-s',
      '-t',
      sessionName,
      '-F',
      '#{pane_id} #{pane_title}',
    ]);
    const map = new Map<string, string>();
    for (const line of output.split('\n').filter(Boolean)) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const paneId = line.slice(0, spaceIdx);
      const title = line.slice(spaceIdx + 1);
      if (paneId && title) {
        map.set(title, paneId);
      }
    }
    return map;
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

  selectPane(paneId: string): void {
    this.exec(['select-pane', '-t', paneId]);
  }

  /** Returns the tmux pane ID of the currently active (selected) pane. */
  getCurrentPaneId(): string {
    return this.exec(['display-message', '-p', '#{pane_id}']);
  }

  /** Returns the tmux session name of the session running this process. */
  getCurrentSessionName(): string {
    return this.exec(['display-message', '-p', '#{session_name}']);
  }

  /** Returns the name of the command currently running in a pane (e.g. bash, zsh, claude). */
  getPaneCurrentCommand(paneId: string): string {
    try {
      return this.exec(['display-message', '-t', paneId, '-p', '#{pane_current_command}']);
    } catch {
      return '';
    }
  }

  /** Resizes a pane to the given column width. */
  resizePane(paneId: string, width: number): void {
    this.exec(['resize-pane', '-t', paneId, '-x', String(width)]);
  }

  /**
   * Pins the sidebar at a fixed width using tmux's main-vertical layout.
   * Sets main-pane-width then applies main-vertical, which places the invoking
   * pane full-height on the left with all other panes stacked on the right.
   * Also sets pane-border-format to read from @paw_role so paw-managed pane
   * labels are permanent and cannot be stomped by app escape sequences.
   */
  pinSidebarLayout(sessionName: string, width: number): void {
    this.exec(['set-window-option', '-t', sessionName, 'main-pane-width', String(width)]);
    this.exec(['select-layout', '-t', sessionName, 'main-vertical']);
    this.exec(['set-window-option', '-t', sessionName, 'pane-border-status', 'top']);
    this.exec([
      'set-window-option',
      '-t',
      sessionName,
      'pane-border-format',
      ' #{?#{@paw_role},#{@paw_role},#{pane_current_command}} ',
    ]);
  }

  setPaneTitle(paneId: string, title: string): void {
    this.exec(['select-pane', '-t', paneId, '-T', title]);
  }

  /**
   * Sets a permanent paw role label on a pane via a custom tmux user option (@paw_role).
   * Unlike pane titles set via select-pane -T, custom user options cannot be
   * overwritten by application escape sequences (e.g. Claude Code's title updates).
   */
  setPaneRole(paneId: string, role: string): void {
    this.exec(['set-option', '-p', '-t', paneId, '@paw_role', role]);
  }

  setPaneProject(paneId: string, projectRoot: string): void {
    this.exec(['set-option', '-p', '-t', paneId, '@paw_project', projectRoot]);
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
 * Check that tmux is available. Call this at the top of commands that need
 * tmux (paw, paw launch, paw go). On Windows, detects WSL and tmux inside
 * it to show the right guidance. Prints install instructions and exits
 * if tmux is not found.
 */
export function requireTmux(): void {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'pipe' });
    return;
  } catch {
    // tmux not in PATH — show platform-specific guidance
  }

  if (process.platform === 'win32') {
    printWindowsTmuxError();
  } else {
    printUnixTmuxError();
  }
  process.exit(1);
}

function tryExec(cmd: string, args: string[], timeoutMs = 5000): string | null {
  try {
    return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch {
    return null;
  }
}

function printWindowsTmuxError(): void {
  // Check if tmux exists inside WSL
  const wslTmux = tryExec('wsl', ['-e', 'tmux', '-V']);

  if (wslTmux) {
    // Best case: tmux is in WSL, user just needs to switch shells
    const wslPath = tryExec('wsl', ['-e', 'wslpath', process.cwd()]);
    const cdPath = wslPath ?? '/mnt/c/.../' + basename(process.cwd());
    const msg = [
      `paw requires tmux — run paw from inside WSL.\n`,
      `  ${wslTmux} found in WSL.\n`,
      '  Open a WSL terminal, then:',
      `    cd '${cdPath}'`,
      '    paw',
    ];
    console.error(msg.join('\n'));
    return;
  }

  // Check if WSL exists at all
  const wslCheck = tryExec('wsl', ['--status']);

  if (wslCheck !== null) {
    // WSL exists but no tmux
    const msg = [
      'paw requires tmux.\n',
      '  WSL detected but tmux is not installed. Inside a WSL terminal:',
      '    sudo apt install tmux\n',
      '  Then run paw from WSL.',
      '',
      '  More info: https://tmux.info/docs/installation',
      '             paw shortcut setup-tmux',
    ];
    console.error(msg.join('\n'));
  } else {
    // No WSL
    const msg = [
      'paw requires tmux.\n',
      '  On Windows, paw runs inside WSL. Install WSL2 first:\n',
      '    wsl --install          (PowerShell as Admin)\n',
      '  Then inside WSL:',
      '    sudo apt install tmux\n',
      '  More info: https://tmux.info/docs/installation',
      '             paw shortcut setup-tmux',
    ];
    console.error(msg.join('\n'));
  }
}

function detectLinuxDistro(): 'debian' | 'fedora' | 'arch' | 'unknown' {
  try {
    const release = readFileSync('/etc/os-release', 'utf-8');
    const idLine = release.match(/^ID(?:_LIKE)?=(.+)$/m);
    const id = idLine?.[1]?.replace(/"/g, '').toLowerCase() ?? '';
    if (id.includes('debian') || id.includes('ubuntu')) return 'debian';
    if (id.includes('fedora') || id.includes('rhel') || id.includes('centos')) return 'fedora';
    if (id.includes('arch')) return 'arch';
  } catch {
    // /etc/os-release not available
  }
  return 'unknown';
}

function printUnixTmuxError(): void {
  const lines = ['paw requires tmux.\n'];

  if (process.platform === 'darwin') {
    lines.push('  Install with Homebrew:');
    lines.push('    brew install tmux');
  } else {
    const distro = detectLinuxDistro();
    switch (distro) {
      case 'debian':
        lines.push('    sudo apt install tmux');
        break;
      case 'fedora':
        lines.push('    sudo dnf install tmux');
        break;
      case 'arch':
        lines.push('    sudo pacman -S tmux');
        break;
      default:
        lines.push('  Ubuntu/Deb:  sudo apt install tmux');
        lines.push('  Fedora/RHEL: sudo dnf install tmux');
        lines.push('  Arch:        sudo pacman -S tmux');
        break;
    }
  }

  lines.push('');
  lines.push('  More info: https://tmux.info/docs/installation');
  lines.push('             paw shortcut setup-tmux');
  console.error(lines.join('\n'));
}

export function isInsideTmux(): boolean {
  return !!process.env['TMUX'];
}

/** Parse the agent name from a command string (first word). Defaults to 'claude'. */
function parseAgentName(command: string): AgentName {
  const base = command.trim().split(/\s+/)[0] ?? '';
  return (AGENT_NAMES as readonly string[]).includes(base) ? (base as AgentName) : 'claude';
}

/**
 * Launch agents in tmux panes for the given worktrees.
 * Creates the tmux session if it doesn't exist, then creates a pane
 * per worktree and sends the agent command.
 *
 * When `existingPanes` is provided, tasks that already have a live pane
 * (verified via `paneExists`) are skipped — only missing tasks get new panes.
 */
export function launchTmux(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  worktrees: Array<{ taskName: string; worktreePath: string; agentCommand: string }>,
  existingPanes: PawPane[] = [],
): PawPane[] {
  if (!tmux.sessionExists(sessionName)) {
    tmux.createSession(sessionName, repoRoot);
  }

  // Index existing panes by taskName for fast lookup.
  const liveByTask = new Map<string, PawPane>();
  for (const ep of existingPanes) {
    if (tmux.paneExists(ep.paneId)) {
      liveByTask.set(ep.taskName, ep);
    }
  }

  const panes: PawPane[] = [];
  let paneIndex = 1;

  for (const wt of worktrees) {
    if (liveByTask.has(wt.taskName)) continue;

    const paneId = tmux.createPane(sessionName, wt.worktreePath);
    const pane: PawPane = {
      id: `paw-${paneIndex}`,
      paneId,
      taskName: wt.taskName,
      worktreePath: wt.worktreePath,
      agent: parseAgentName(wt.agentCommand),
      branchName: '',
    };

    tmux.setPaneTitle(paneId, `paw-${wt.taskName}`);
    tmux.setPaneRole(paneId, `paw-${wt.taskName}`);
    tmux.setPaneProject(paneId, repoRoot);
    tmux.sendKeys(paneId, wt.agentCommand);

    panes.push(pane);
    paneIndex++;
  }

  return panes;
}

export function createTmuxService(): TmuxService {
  return new TmuxService();
}
