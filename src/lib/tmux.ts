import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  BEACON_MESSAGE,
  BEACON_TUI_TIMEOUT_MS,
  BEACON_POLL_INTERVAL_MS,
  BEACON_VERIFY_ATTEMPTS,
  BEACON_VERIFY_DELAY_MS,
} from './constants.js';

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
  /** Pane role from @paw_role custom option. Empty string if not set. */
  role: string;
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

/** Agent running in a detached tmux session. */
export interface DetachedAgent {
  id: string;
  /** tmux session name: paw-{project}-{task}. */
  sessionName: string;
  taskName: string;
  worktreePath: string;
  agent: AgentName;
  branchName: string;
}

/** Persisted session state. */
export interface PawPaneConfig {
  /** 'attached' when inside tmux, 'detached' when running background sessions. */
  mode?: 'attached' | 'detached';
  /** tmux session name. */
  sessionName: string;
  /** Repo root path. */
  projectRoot: string;
  /**
   * Pane ID of the orchestrator shell (pane 1). Empty string if not yet created.
   * The orchestrator is where the user types their AI agent command (claude, codex, etc.).
   */
  orchestratorPaneId: string;
  /** Active agent panes (panes 2+) — attached mode. */
  panes: PawPane[];
  /** Detached tmux sessions — detached mode. */
  detached?: DetachedAgent[];
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
  /** Capture visible pane content. Returns null if capture fails or content is empty. */
  capturePaneContent(sessionOrPane: string, lines?: number): string | null;
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
      '#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}\t#{@paw_project}\t#{@paw_role}',
    ]);
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [paneId = '', title = '', command = '', cwd = '', project = '', role = ''] =
          line.split('\t');
        return { paneId, title, command, cwd, project, role };
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

  capturePaneContent(sessionOrPane: string, lines = 50): string | null {
    try {
      const output = this.exec(['capture-pane', '-t', sessionOrPane, '-p', '-S', `-${lines}`]);
      return output.length > 0 ? output : null;
    } catch {
      return null;
    }
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
 * Verify tmux is installed (but not necessarily that we're inside a session).
 * Use this in commands that need tmux as a background process manager (go, launch).
 */
export function ensureTmuxInstalled(): void {
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

/**
 * Check that tmux is available. Delegates to ensureTmuxInstalled().
 * Kept for backward compatibility — used only by `tui.ts`.
 */
export function requireTmux(): void {
  ensureTmuxInstalled();
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

/**
 * Send a nudge message via tmux send-keys to wake up an idle agent.
 * Flattens newlines to spaces, sends the message, waits 500ms, then sends
 * an empty Enter (first Enter may be consumed by TUI re-render).
 * Retries up to 3 times on failure. Returns true if successful.
 */
export async function sendNudgeKeys(
  tmux: TmuxServiceApi,
  target: string,
  message: string,
): Promise<boolean> {
  const flattened = message.replace(/\n/g, ' ');
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      tmux.sendKeys(target, flattened);
      await new Promise((resolve) => setTimeout(resolve, 500));
      tmux.sendKeys(target, '');
      return true;
    } catch {
      if (attempt === maxRetries - 1) return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
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
export async function launchTmux(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  worktrees: Array<{ taskName: string; worktreePath: string; agentCommand: string }>,
  existingPanes: PawPane[] = [],
  beaconOpts?: BeaconOptions,
): Promise<PawPane[]> {
  if (!tmux.sessionExists(sessionName)) {
    tmux.createSession(sessionName, repoRoot);
  }

  // Query tmux once for all live pane IDs, then index existing panes.
  const livePaneIds = new Set(tmux.listPanes(sessionName));
  const liveByTask = new Map<string, PawPane>();
  for (const ep of existingPanes) {
    if (livePaneIds.has(ep.paneId)) {
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
    await sendBeacon(tmux, paneId, beaconOpts);

    panes.push(pane);
    paneIndex++;
  }

  return panes;
}

export function createTmuxService(): TmuxService {
  return new TmuxService();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the Claude Code interactive prompt to be ready in a tmux session/pane.
 * Polls capture-pane until `isTuiPromptReady()` returns true.
 */
export async function waitForTuiReady(
  tmux: TmuxServiceApi,
  sessionOrPane: string,
  timeoutMs = BEACON_TUI_TIMEOUT_MS,
  pollIntervalMs = BEACON_POLL_INTERVAL_MS,
): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    const content = tmux.capturePaneContent(sessionOrPane);
    if (content !== null && isTuiPromptReady(content)) return true;
    if (!tmux.sessionExists(sessionOrPane)) return false;
    await sleep(pollIntervalMs);
  }
  return false;
}

/** Check if captured pane content shows the Claude Code interactive prompt. */
export function isTuiPromptReady(content: string): boolean {
  if (content.includes('❯')) return true;
  if (content.includes('Try "')) return true;
  if (/^>/m.test(content)) return true;
  return false;
}

export interface BeaconOptions {
  tuiTimeoutMs?: number;
  tuiPollIntervalMs?: number;
  postReadyDelayMs?: number;
  verifyAttempts?: number;
  verifyDelayMs?: number;
  /** Delays (ms) for follow-up empty Enters after initial beacon send. */
  followUpDelays?: number[];
}

/** Send the initial task message to an agent after Claude Code boots. */
export async function sendBeacon(
  tmux: TmuxServiceApi,
  sessionOrPane: string,
  opts: BeaconOptions = {},
): Promise<boolean> {
  const tuiTimeoutMs = opts.tuiTimeoutMs ?? BEACON_TUI_TIMEOUT_MS;
  const tuiPollIntervalMs = opts.tuiPollIntervalMs ?? BEACON_POLL_INTERVAL_MS;
  const postReadyDelayMs = opts.postReadyDelayMs ?? 1_000;
  const verifyAttempts = opts.verifyAttempts ?? BEACON_VERIFY_ATTEMPTS;
  const verifyDelayMs = opts.verifyDelayMs ?? BEACON_VERIFY_DELAY_MS;
  const followUpDelays = opts.followUpDelays ?? [5_000, 10_000];

  const ready = await waitForTuiReady(tmux, sessionOrPane, tuiTimeoutMs, tuiPollIntervalMs);
  if (!ready) return false;

  await sleep(postReadyDelayMs);

  tmux.sendKeys(sessionOrPane, BEACON_MESSAGE);

  // Follow-up empty Enters to dismiss trust prompt or late TUI initialization
  for (const delay of followUpDelays) {
    await sleep(delay);
    tmux.sendKeys(sessionOrPane, '');
  }

  // Retry if welcome screen is still visible
  for (let attempt = 0; attempt < verifyAttempts; attempt++) {
    await sleep(verifyDelayMs);
    const content = tmux.capturePaneContent(sessionOrPane);
    if (content && !content.includes('Try "')) return true;
    tmux.sendKeys(sessionOrPane, BEACON_MESSAGE);
    await sleep(followUpDelays[0] ?? 1_000);
    tmux.sendKeys(sessionOrPane, '');
  }

  return true;
}

export interface AgentLivenessResult {
  taskName: string;
  alive: boolean;
}

/** Check whether each agent is still alive in tmux. Works for both attached and detached modes. */
export function checkAgentLiveness(
  tmux: TmuxServiceApi,
  config: PawPaneConfig,
): AgentLivenessResult[] {
  const mode = config.mode ?? 'attached';

  if (mode === 'detached' && config.detached) {
    return config.detached.map((agent) => ({
      taskName: agent.taskName,
      alive: tmux.sessionExists(agent.sessionName),
    }));
  }

  return config.panes.map((pane) => ({
    taskName: pane.taskName,
    alive: tmux.paneExists(pane.paneId),
  }));
}

/** Create a detached tmux session, send the agent command, and send the startup beacon. */
export async function createDetachedSession(
  tmux: TmuxServiceApi,
  sessionName: string,
  cwd: string,
  agentCommand: string,
  beaconOpts?: BeaconOptions,
): Promise<void> {
  tmux.createSession(sessionName, cwd);
  tmux.sendKeys(sessionName, agentCommand);
  await sendBeacon(tmux, sessionName, beaconOpts);
}

/** Kill a detached tmux session if it exists. */
export function killDetachedSession(tmux: TmuxServiceApi, sessionName: string): void {
  if (tmux.sessionExists(sessionName)) {
    tmux.killSession(sessionName);
  }
}

/** Check which of the given session names are still alive. */
export function listDetachedSessions(tmux: TmuxServiceApi, sessionNames: string[]): string[] {
  return sessionNames.filter((name) => tmux.sessionExists(name));
}

/**
 * Launch agents in detached tmux sessions (one session per task).
 * Returns DetachedAgent records for persistence.
 */
export async function launchDetached(
  tmux: TmuxServiceApi,
  sessionPrefix: string,
  worktrees: Array<{
    taskName: string;
    worktreePath: string;
    agentCommand: string;
    branchName?: string;
  }>,
  existingAgents: DetachedAgent[] = [],
  beaconOpts?: BeaconOptions,
): Promise<DetachedAgent[]> {
  const liveByTask = new Map<string, DetachedAgent>();
  for (const ea of existingAgents) {
    if (tmux.sessionExists(ea.sessionName)) {
      liveByTask.set(ea.taskName, ea);
    }
  }

  const agents: DetachedAgent[] = [];
  let index = 1;

  for (const wt of worktrees) {
    if (liveByTask.has(wt.taskName)) continue;

    const sessionName = `${sessionPrefix}-${wt.taskName}`;
    await createDetachedSession(tmux, sessionName, wt.worktreePath, wt.agentCommand, beaconOpts);

    agents.push({
      id: `paw-${index}`,
      sessionName,
      taskName: wt.taskName,
      worktreePath: wt.worktreePath,
      agent: parseAgentName(wt.agentCommand),
      branchName: wt.branchName ?? '',
    });
    index++;
  }

  return agents;
}
