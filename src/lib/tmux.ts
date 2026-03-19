import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import pc from 'picocolors';
import {
  BEACON_MESSAGE,
  BEACON_AGENT_TIMEOUT_MS,
  BEACON_POLL_INTERVAL_MS,
  BEACON_VERIFY_ATTEMPTS,
  BEACON_VERIFY_DELAY_MS,
  BEACON_SESSION_READY_TIMEOUT_MS,
  BEACON_FOLLOWUP_DELAYS,
} from './constants.js';
import { sleep } from './util.js';

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
  /** Project root from @fleet_project custom option. Empty string if not set. */
  project: string;
  /** Pane role from @fleet_role custom option. Empty string if not set. */
  role: string;
}

import type { DetachedAgent, FleetPaneConfig } from './pane-state.js';
export type { DetachedAgent, FleetPaneConfig } from './pane-state.js';

/**
 * Interface for tmux operations. Enables dependency injection for testing.
 */
export interface TmuxServiceApi {
  sessionExists(name: string): boolean;
  createSession(name: string, cwd: string): void;
  killSession(name: string): void;
  listPanesDetailed(sessionName: string): TmuxPaneInfo[];
  sendKeys(paneId: string, keys: string): void;
  setPaneTitle(paneId: string, title: string): void;
  /** Sets a permanent fleet role label via a custom tmux user option (@fleet_role). */
  setPaneRole(paneId: string, role: string): void;
  /** Sets the project root on a pane via @fleet_project custom user option. */
  setPaneProject(paneId: string, projectRoot: string): void;
  getCurrentSessionName(): string;
  getPaneCurrentCommand(paneId: string): string | null;
  /** List all tmux session names. Returns empty array if tmux is not running. */
  listSessions(): string[];
  /** Capture visible pane content. Returns null if capture fails or content is empty. */
  capturePaneContent(sessionOrPane: string, lines?: number): string | null;
}

/** Centralizes all tmux CLI calls. */
function execTmux(
  args: string[],
  opts?: { encoding?: BufferEncoding; stdio?: 'pipe' | 'ignore' },
): string {
  const encoding = opts?.encoding ?? 'utf-8';
  const stdio = opts?.stdio ?? 'pipe';
  return execFileSync('tmux', args, { encoding, stdio }).trim();
}

/** Assumes tmux is available — no platform detection or WSL bridge. */
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

  /** List all panes in a session with their ID, title, command, cwd, and project. */
  listPanesDetailed(sessionName: string): TmuxPaneInfo[] {
    const output = this.exec([
      'list-panes',
      '-s',
      '-t',
      sessionName,
      '-F',
      '#{pane_id}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}\t#{@fleet_project}\t#{@fleet_role}',
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

  sendKeys(paneId: string, keys: string): void {
    this.exec(['send-keys', '-t', paneId, keys, 'Enter']);
  }

  getCurrentSessionName(): string {
    return this.exec(['display-message', '-p', '#{session_name}']);
  }

  getPaneCurrentCommand(paneId: string): string | null {
    try {
      return this.exec(['display-message', '-t', paneId, '-p', '#{pane_current_command}']);
    } catch {
      return null;
    }
  }

  setPaneTitle(paneId: string, title: string): void {
    this.exec(['select-pane', '-t', paneId, '-T', title]);
  }

  /**
   * Sets a permanent fleet role label on a pane via a custom tmux user option (@fleet_role).
   * Unlike pane titles set via select-pane -T, custom user options cannot be
   * overwritten by application escape sequences (e.g. Claude Code's title updates).
   */
  setPaneRole(paneId: string, role: string): void {
    this.exec(['set-option', '-p', '-t', paneId, '@fleet_role', role]);
  }

  setPaneProject(paneId: string, projectRoot: string): void {
    this.exec(['set-option', '-p', '-t', paneId, '@fleet_project', projectRoot]);
  }

  listSessions(): string[] {
    try {
      const output = this.exec(['list-sessions', '-F', '#{session_name}']);
      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
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
  return `fleet-${dirname
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/** Detect whether running inside WSL (Windows Subsystem for Linux). */
function isWSL(): boolean {
  try {
    const release = readFileSync('/proc/version', 'utf-8');
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}

/**
 * Fail fast when a WSL repo lives on /mnt/ (Windows NTFS mounted in WSL).
 * Git worktree pointers, lefthook binaries, and pnpm hardlinks all break
 * across the NTFS/Linux filesystem boundary. Agents must run on a native FS.
 */
export function ensureNativeFilesystem(repoRoot: string): void {
  if (!isWSL()) return;
  if (!repoRoot.startsWith('/mnt/')) return;

  const repoName = basename(repoRoot);
  const home = homedir();
  const tilde = (p: string) => (p.startsWith(home) ? p.replace(home, '~') : p);

  // Mirror the Windows parent dir: /mnt/c/Users/<user>/repos/foo → ~/repos/foo
  const windowsParent = basename(resolve(repoRoot, '..'));
  const parentDir = /^[a-zA-Z]$|^Users$/i.test(windowsParent) ? 'repos' : windowsParent;

  // Check common dev directories for an existing clone
  const candidates = [
    resolve(home, parentDir, repoName),
    resolve(home, 'repos', repoName),
    resolve(home, 'src', repoName),
    resolve(home, 'dev', repoName),
    resolve(home, 'projects', repoName),
    resolve(home, 'code', repoName),
    resolve(home, repoName),
  ];
  const existing = candidates.find((p) => existsSync(resolve(p, '.git')));
  const dest = existing ?? resolve(home, parentDir, repoName);

  const msg = [
    `This repo is on /mnt/ (Windows NTFS mounted in WSL).`,
    `Fleet agents cannot run reliably on NTFS — git worktrees, pre-commit`,
    `hooks, and native binaries break across the filesystem boundary.\n`,
  ];

  if (existing) {
    msg.push(`Found existing clone at ${tilde(existing)}:\n`, `  cd ${tilde(existing)}\n`);
  } else {
    msg.push(
      `Clone your repo onto the native WSL filesystem:\n`,
      `  git clone ${repoRoot} ${tilde(dest)}`,
      `  cd ${tilde(dest)}\n`,
    );
  }

  msg.push(
    `Your Windows editor can access WSL files at:`,
    `  \\\\wsl$\\<distro>${dest}`,
    `  or: code .   (VS Code Remote-WSL)`,
  );
  console.error(msg.join('\n'));
  throw new Error('Repo must be on the native WSL filesystem, not /mnt/.');
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
  throw new Error('tmux is not installed or not in PATH.');
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

  const repoName = basename(process.cwd());

  if (wslTmux) {
    const msg = [
      `fleet requires tmux — run fleet from inside WSL.\n`,
      `  ${wslTmux} found in WSL.\n`,
      '  Clone your repo onto the native WSL filesystem:',
      `    wsl bash -c "git clone /mnt/c/.../repos/${repoName} ~/repos/${repoName}"`,
      `    wsl bash -c "cd ~/repos/${repoName} && fleet go"\n`,
      '  Do NOT run from /mnt/c/ — NTFS causes broken worktrees and permissions.',
    ];
    console.error(msg.join('\n'));
    return;
  }

  // Check if WSL exists at all
  const wslCheck = tryExec('wsl', ['--status']);

  if (wslCheck !== null) {
    const msg = [
      'fleet requires tmux.\n',
      '  WSL detected but tmux is not installed. Inside a WSL terminal:',
      '    sudo apt install tmux\n',
      '  Then clone your repo onto the native WSL filesystem:',
      `    git clone /mnt/c/.../repos/${repoName} ~/repos/${repoName}`,
      `    cd ~/repos/${repoName}\n`,
      '  Do NOT run from /mnt/c/ — NTFS causes broken worktrees and permissions.',
    ];
    console.error(msg.join('\n'));
  } else {
    const msg = [
      'fleet requires tmux.\n',
      '  On Windows, fleet runs inside WSL. Install WSL2 first:\n',
      '    wsl --install          (PowerShell as Admin)\n',
      '  Then inside WSL:',
      '    sudo apt install tmux\n',
      '  Then clone your repo onto the native WSL filesystem:',
      `    git clone /mnt/c/.../repos/${repoName} ~/repos/${repoName}`,
      `    cd ~/repos/${repoName}\n`,
      '  Do NOT run from /mnt/c/ — NTFS causes broken worktrees and permissions.',
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
  const lines = ['fleet requires tmux.\n'];

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
  console.error(lines.join('\n'));
}

/**
 * Send an empty Enter to wake an idle agent and trigger its hook cycle.
 * No message content — just a poke. The actual nudge content is delivered
 * via the inbox (appendMessage with type: 'nudge').
 */
export function sendWakeSignal(tmux: TmuxServiceApi, target: string): boolean {
  try {
    tmux.sendKeys(target, '');
    return true;
  } catch {
    return false;
  }
}

/** Factory that creates a real `TmuxService` wired to the local tmux binary. */
export function createTmuxService(): TmuxService {
  return new TmuxService();
}

/**
 * Wait for the Claude Code interactive prompt to be ready in a tmux session.
 * Polls capture-pane until `isAgentPromptReady()` returns true.
 */
export async function waitForAgentReady(
  tmux: TmuxServiceApi,
  sessionOrPane: string,
  timeoutMs = BEACON_AGENT_TIMEOUT_MS,
  pollIntervalMs = BEACON_POLL_INTERVAL_MS,
): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    const content = tmux.capturePaneContent(sessionOrPane);
    if (content !== null && isAgentPromptReady(content)) return true;
    if (!tmux.sessionExists(sessionOrPane)) return false;
    await sleep(pollIntervalMs);
  }
  return false;
}

/** Check if captured pane content shows the Claude Code interactive prompt. */
export function isAgentPromptReady(content: string): boolean {
  if (content.includes('❯')) return true;
  if (content.includes('Try "')) return true;
  if (/^>/m.test(content)) return true;
  return false;
}

export interface BeaconOptions {
  agentTimeoutMs?: number;
  agentPollIntervalMs?: number;
  postReadyDelayMs?: number;
  verifyAttempts?: number;
  verifyDelayMs?: number;
  /** Delays (ms) for follow-up empty Enters after initial beacon send. */
  followUpDelays?: number[];
  /** Worktree path — if set, beacon waits for .fleet/.session-ready before sending. */
  worktreePath?: string;
  /** Max time (ms) to wait for session-ready sentinel. Default: 60_000. */
  sessionReadyTimeoutMs?: number;
}

/** Options for the send-and-verify loop. */
export interface SendAndVerifyOptions {
  followUpDelays?: readonly number[];
  verifyAttempts?: number;
  verifyDelayMs?: number;
}

/**
 * Send a message to a tmux session/pane and verify it was accepted.
 * Sends follow-up empty Enters to dismiss trust/permission dialogs,
 * then retries if the welcome screen (`Try "`) is still visible.
 */
export async function sendAndVerifyMessage(
  tmux: TmuxServiceApi,
  sessionOrPane: string,
  message: string,
  opts: SendAndVerifyOptions = {},
): Promise<void> {
  const followUpDelays = opts.followUpDelays ?? BEACON_FOLLOWUP_DELAYS;
  const verifyAttempts = opts.verifyAttempts ?? BEACON_VERIFY_ATTEMPTS;
  const verifyDelayMs = opts.verifyDelayMs ?? BEACON_VERIFY_DELAY_MS;

  tmux.sendKeys(sessionOrPane, message);

  // Follow-up empty Enters to dismiss trust prompt or late initialization
  for (const delay of followUpDelays) {
    await sleep(delay);
    tmux.sendKeys(sessionOrPane, '');
  }

  // Retry if welcome screen is still visible
  for (let attempt = 0; attempt < verifyAttempts; attempt++) {
    await sleep(verifyDelayMs);
    const content = tmux.capturePaneContent(sessionOrPane);
    // null = can't capture (session gone), non-null without welcome screen = accepted
    if (!content || !content.includes('Try "')) return;
    tmux.sendKeys(sessionOrPane, message);
    await sleep(followUpDelays[0] ?? BEACON_FOLLOWUP_DELAYS[0]!);
    tmux.sendKeys(sessionOrPane, '');
  }
}

/** Send the initial task message to an agent after Claude Code boots. */
export async function sendBeacon(
  tmux: TmuxServiceApi,
  sessionOrPane: string,
  opts: BeaconOptions = {},
): Promise<boolean> {
  const agentTimeoutMs = opts.agentTimeoutMs ?? BEACON_AGENT_TIMEOUT_MS;
  const agentPollIntervalMs = opts.agentPollIntervalMs ?? BEACON_POLL_INTERVAL_MS;
  const postReadyDelayMs = opts.postReadyDelayMs ?? 1_000;
  const verifyAttempts = opts.verifyAttempts ?? BEACON_VERIFY_ATTEMPTS;
  const verifyDelayMs = opts.verifyDelayMs ?? BEACON_VERIFY_DELAY_MS;
  const followUpDelays = opts.followUpDelays ?? BEACON_FOLLOWUP_DELAYS;
  const sessionReadyTimeoutMs = opts.sessionReadyTimeoutMs ?? BEACON_SESSION_READY_TIMEOUT_MS;

  // When a worktree sentinel is available, it is the authoritative readiness
  // signal — wait for it first, then do a quick prompt check.
  if (opts.worktreePath && sessionReadyTimeoutMs > 0) {
    const sentinel = resolve(opts.worktreePath, '.fleet', 'run', '.session-ready');
    const pollMs = Math.max(agentPollIntervalMs, 500);
    const maxAttempts = Math.ceil(sessionReadyTimeoutMs / pollMs);
    let found = false;
    for (let i = 0; i < maxAttempts; i++) {
      if (existsSync(sentinel)) {
        try {
          rmSync(sentinel);
        } catch {
          /* best-effort cleanup */
        }
        found = true;
        break;
      }
      await sleep(pollMs);
    }
    // Sentinel found — give the agent a moment to settle, but don't gate on it.
    // If the sentinel was never written, still attempt the beacon (best-effort).
    if (found) {
      await waitForAgentReady(tmux, sessionOrPane, agentTimeoutMs, agentPollIntervalMs);
    }
  } else {
    const ready = await waitForAgentReady(tmux, sessionOrPane, agentTimeoutMs, agentPollIntervalMs);
    if (!ready) return false;
  }

  await sleep(postReadyDelayMs);

  await sendAndVerifyMessage(tmux, sessionOrPane, BEACON_MESSAGE, {
    followUpDelays,
    verifyAttempts,
    verifyDelayMs,
  });

  return true;
}

export interface AgentLivenessResult {
  taskName: string;
  alive: boolean;
}

/** Check whether each detached agent is still alive in tmux. */
export function checkAgentLiveness(
  tmux: TmuxServiceApi,
  config: FleetPaneConfig,
): AgentLivenessResult[] {
  return config.detached.map((agent) => ({
    taskName: agent.taskName,
    alive: tmux.sessionExists(agent.sessionName),
  }));
}

/** Index liveness results by task name for O(1) lookup. */
export function buildLivenessMap(results: AgentLivenessResult[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const r of results) {
    map.set(r.taskName, r.alive);
  }
  return map;
}

/** Return a colored status dot: green ● alive, red ○ dead, space if unknown. */
export function livenessMarker(alive: boolean | undefined): string {
  if (alive === undefined) return ' ';
  return alive ? pc.green('●') : pc.red('○');
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

/** Tear down a detached session if it still exists (idempotent). */
export function killDetachedSession(tmux: TmuxServiceApi, sessionName: string): void {
  if (tmux.sessionExists(sessionName)) {
    tmux.killSession(sessionName);
  }
}

/** @internal - exported for testing */
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

  const pendingWorktrees = worktrees.filter((wt) => !liveByTask.has(wt.taskName));

  const agents = await Promise.all(
    pendingWorktrees.map(async (wt) => {
      const sessionName = `${sessionPrefix}-${wt.taskName}`;
      await createDetachedSession(tmux, sessionName, wt.worktreePath, wt.agentCommand, {
        ...beaconOpts,
        worktreePath: wt.worktreePath,
      });
      return {
        id: `fleet-${worktrees.indexOf(wt) + 1}`,
        sessionName,
        taskName: wt.taskName,
        worktreePath: wt.worktreePath,
        branchName: wt.branchName ?? '',
      };
    }),
  );

  return agents;
}
