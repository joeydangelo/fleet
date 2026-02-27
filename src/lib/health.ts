/** ZFC Health Monitoring — state machine, heartbeat I/O, and nudge delivery. */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  STALL_THRESHOLD_S,
  ZOMBIE_THRESHOLD_S,
  NUDGE_INTERVAL_S,
  MAX_ESCALATION_LEVEL,
  TRIAGE_TIMEOUT_MS,
  TRIAGE_CAPTURE_LINES,
} from './constants.js';
import type { TmuxServiceApi } from './tmux.js';

// --- Types ---

export type HealthState = 'booting' | 'working' | 'stalled' | 'zombie' | 'completed';

export interface AgentHealth {
  taskName: string;
  state: HealthState;
  /** ISO timestamp of last tool invocation (from heartbeat file). */
  lastActivity: string | null;
  /** ISO timestamp when stall was first detected. */
  stalledSince: string | null;
  /** Progressive escalation stage: 0=warn, 1=nudge, 2=triage, 3=terminate. */
  escalationLevel: number;
}

export type TriageVerdict = 'extend' | 'retry' | 'terminate';

export interface HealthSnapshot {
  timestamp: string;
  agents: Record<string, AgentHealth>;
}

// --- Pure state evaluation (no I/O) ---

/**
 * Resolve the health state for a single agent. Pure function — no I/O.
 *
 * A launch heartbeat is written at spawn time, so lastActivity always exists.
 * The 'booting' state is handled by evaluateAllAgents(), not here.
 */
export function resolveHealthState(opts: {
  taskDone: boolean;
  tmuxAlive: boolean;
  lastActivity: string | null;
  now: Date;
  stallThreshold: number;
  zombieThreshold: number;
}): HealthState {
  const { taskDone, tmuxAlive, lastActivity, now } = opts;
  const { stallThreshold, zombieThreshold } = opts;

  if (taskDone) return 'completed';
  if (!tmuxAlive) return 'zombie';
  if (!lastActivity) return 'zombie';

  const activityMs = new Date(lastActivity).getTime();
  const elapsedS = (now.getTime() - activityMs) / 1000;

  if (elapsedS < stallThreshold) return 'working';
  if (elapsedS < zombieThreshold) return 'stalled';
  return 'zombie';
}

/**
 * Compute the expected escalation level from elapsed stall time.
 * Level advances by one for each nudge interval elapsed, capped at max.
 */
export function computeEscalationLevel(
  stalledSince: string,
  now: Date,
  nudgeInterval: number = NUDGE_INTERVAL_S,
  maxLevel: number = MAX_ESCALATION_LEVEL,
): number {
  const stalledMs = now.getTime() - new Date(stalledSince).getTime();
  return Math.min(Math.floor(stalledMs / (nudgeInterval * 1000)), maxLevel);
}

/**
 * Evaluate health for all agents in a session. Composes I/O reads with
 * pure resolveHealthState() evaluation.
 */
export function evaluateAllAgents(opts: {
  repoRoot: string;
  taskNames: string[];
  syncTasks: Record<string, { status: string }>;
  livenessMap: Map<string, boolean>;
  prevHealth: HealthSnapshot | null;
  now: Date;
}): HealthSnapshot {
  const { repoRoot, taskNames, syncTasks, livenessMap, prevHealth, now } = opts;

  const agents: Record<string, AgentHealth> = {};

  for (const taskName of taskNames) {
    const taskDone = syncTasks[taskName]?.status === 'done';
    const tmuxAlive = livenessMap.get(taskName) ?? true; // assume alive if no data
    const lastActivity = readHeartbeat(repoRoot, taskName);
    const prev = prevHealth?.agents[taskName];

    const rawState = resolveHealthState({
      taskDone,
      tmuxAlive,
      lastActivity,
      now,
      stallThreshold: STALL_THRESHOLD_S,
      zombieThreshold: ZOMBIE_THRESHOLD_S,
    });

    // Stays 'booting' until the heartbeat value changes from the launch-written one
    let state = rawState;
    if (rawState === 'working') {
      if (!prev) {
        state = 'booting';
      } else if (prev.state === 'booting') {
        state = lastActivity !== prev.lastActivity ? 'working' : 'booting';
      }
    }

    let stalledSince = prev?.stalledSince ?? null;
    let escalationLevel = prev?.escalationLevel ?? 0;

    if (state === 'stalled' && prev?.state !== 'stalled') {
      stalledSince = now.toISOString();
      escalationLevel = 0;
    } else if (state === 'stalled' && stalledSince) {
      const expected = computeEscalationLevel(stalledSince, now);
      if (expected > escalationLevel) {
        escalationLevel = expected;
      }
    } else if (state !== 'stalled') {
      stalledSince = null;
      escalationLevel = 0;
    }

    agents[taskName] = {
      taskName,
      state,
      lastActivity,
      stalledSince,
      escalationLevel,
    };
  }

  return { timestamp: now.toISOString(), agents };
}

// --- Heartbeat I/O ---

/** Read the last heartbeat timestamp for a task. Returns null if no heartbeat exists. */
export function readHeartbeat(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'run', 'heartbeats', taskName);
    return readFileSync(filePath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** Write a heartbeat timestamp for a task. */
export function writeHeartbeat(repoRoot: string, taskName: string): void {
  const dir = resolve(repoRoot, '.paw', 'run', 'heartbeats');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, taskName), new Date().toISOString(), 'utf-8');
}

// --- Health snapshot I/O ---

/** Read the computed health snapshot. Returns null if not yet written. */
export function readHealthSnapshot(repoRoot: string): HealthSnapshot | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'run', 'health.json');
    return JSON.parse(readFileSync(filePath, 'utf-8')) as HealthSnapshot;
  } catch {
    return null;
  }
}

/** Write the computed health snapshot (single writer: watch loop only). */
export function writeHealthSnapshot(repoRoot: string, snapshot: HealthSnapshot): void {
  const dir = resolve(repoRoot, '.paw', 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'health.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

// --- Nudge I/O ---

/** Write a nudge message for an agent to pick up. */
export function writeNudge(repoRoot: string, taskName: string, message: string): void {
  const dir = resolve(repoRoot, '.paw', 'run', 'nudges');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${taskName}.md`), message, 'utf-8');
}

/** Read a pending nudge for a task. Returns null if no nudge is pending. */
export function readNudge(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'run', 'nudges', `${taskName}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Delete a nudge file after the agent has read it. */
export function clearNudge(repoRoot: string, taskName: string): void {
  try {
    rmSync(resolve(repoRoot, '.paw', 'run', 'nudges', `${taskName}.md`));
  } catch {
    // Already cleared or never existed
  }
}

// --- Inbox cursor I/O ---

/** Read the inbox cursor (ISO timestamp) for a task. Returns null if no cursor exists. */
export function readInboxCursor(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'run', `.inbox-cursor-${taskName}`);
    return readFileSync(filePath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** Write the inbox cursor (ISO timestamp) for a task. */
export function writeInboxCursor(repoRoot: string, taskName: string, cursor: string): void {
  const dir = resolve(repoRoot, '.paw', 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `.inbox-cursor-${taskName}`), cursor, 'utf-8');
}

// --- Triage ---

/**
 * Triage a stalled agent by capturing terminal output and classifying
 * the situation via Claude AI.
 *
 * Returns the verdict and captured terminal content.
 */
export function triageAgent(
  tmux: TmuxServiceApi,
  target: string,
  taskName: string,
): { verdict: TriageVerdict; captured: string } {
  const captured = tmux.capturePaneContent(target, TRIAGE_CAPTURE_LINES) ?? '';

  const prompt =
    `You are a triage system for an AI coding agent running in tmux.\n` +
    `The agent "${taskName}" appears stalled (no tool activity for several minutes).\n` +
    `Below is the last ${TRIAGE_CAPTURE_LINES} lines of terminal output.\n\n` +
    `Classify as one of:\n` +
    `- EXTEND: Agent appears actively working (compiling, testing, thinking). Grant more time.\n` +
    `- RETRY: Agent is stuck in an error loop or waiting at a prompt. Send recovery nudge.\n` +
    `- TERMINATE: Agent has crashed, exited, or is unrecoverable (bash prompt, segfault, OOM).\n\n` +
    `Respond with EXACTLY one word: EXTEND, RETRY, or TERMINATE.\n\n` +
    `Terminal output:\n${captured}`;

  try {
    const result = execFileSync('claude', ['--print', '-p', prompt], {
      encoding: 'utf-8',
      timeout: TRIAGE_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const upper = result.toUpperCase();
    if (upper.includes('TERMINATE')) return { verdict: 'terminate', captured };
    if (upper.includes('RETRY')) return { verdict: 'retry', captured };
    // Default to 'extend' on any other response (safe default)
    return { verdict: 'extend', captured };
  } catch {
    // On failure (timeout, claude not found, etc.), default to extend (safe)
    return { verdict: 'extend', captured };
  }
}

/** Save triage output for post-mortem debugging. */
export function saveTriageOutput(
  repoRoot: string,
  taskName: string,
  captured: string,
  verdict: string,
): void {
  const dir = resolve(repoRoot, '.paw', 'run', 'triage');
  mkdirSync(dir, { recursive: true });
  const content =
    `Triage verdict: ${verdict}\n` +
    `Timestamp: ${new Date().toISOString()}\n` +
    `Task: ${taskName}\n\n` +
    `--- Terminal capture ---\n${captured}\n`;
  writeFileSync(resolve(dir, `${taskName}.txt`), content, 'utf-8');
}
