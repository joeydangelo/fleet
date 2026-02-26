/**
 * ZFC Health Monitoring — state machine, heartbeat I/O, and nudge delivery.
 *
 * Inspired by overstory's Zero Failure Crash design:
 * observable state (heartbeats + tmux) always beats recorded state (commits).
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import {
  STALL_THRESHOLD_S,
  ZOMBIE_THRESHOLD_S,
  BOOT_GRACE_S,
  NUDGE_INTERVAL_S,
  MAX_NUDGES,
} from './constants.js';

// --- Types ---

export type HealthState = 'booting' | 'working' | 'stalled' | 'zombie' | 'completed';

export interface AgentHealth {
  taskName: string;
  state: HealthState;
  /** ISO timestamp of last tool invocation (from heartbeat file). */
  lastActivity: string | null;
  /** ISO timestamp when stall was first detected. */
  stalledSince: string | null;
  /** Number of nudges sent while stalled. */
  nudgeCount: number;
  /** ISO timestamp of last nudge sent. */
  lastNudge: string | null;
}

export interface HealthSnapshot {
  timestamp: string;
  agents: Record<string, AgentHealth>;
}

// --- Pure state evaluation (no I/O) ---

/**
 * Resolve the health state for a single agent. Pure function — all inputs
 * are passed as parameters, no file system access.
 *
 * ZFC rules (priority order):
 * 1. taskDone → completed
 * 2. tmux dead + not done → zombie immediately
 * 3. No heartbeat + within boot grace → booting
 * 4. No heartbeat + past boot grace → zombie
 * 5. Activity within stall threshold → working
 * 6. Activity within zombie threshold → stalled
 * 7. Activity past zombie threshold → zombie
 */
export function resolveHealthState(opts: {
  taskDone: boolean;
  tmuxAlive: boolean;
  lastActivity: string | null;
  launchTime: string;
  now: Date;
  stallThreshold: number;
  zombieThreshold: number;
  bootGrace: number;
}): HealthState {
  const { taskDone, tmuxAlive, lastActivity, launchTime, now } = opts;
  const { stallThreshold, zombieThreshold, bootGrace } = opts;

  // Rule 1: completed tasks are completed
  if (taskDone) return 'completed';

  // Rule 2: dead tmux session → zombie immediately (ZFC: observable beats recorded)
  if (!tmuxAlive) return 'zombie';

  // No heartbeat yet — check boot grace
  if (!lastActivity) {
    const launchMs = new Date(launchTime).getTime();
    const elapsedS = (now.getTime() - launchMs) / 1000;
    return elapsedS < bootGrace ? 'booting' : 'zombie';
  }

  // Has heartbeat — check staleness
  const activityMs = new Date(lastActivity).getTime();
  const elapsedS = (now.getTime() - activityMs) / 1000;

  if (elapsedS < stallThreshold) return 'working';
  if (elapsedS < zombieThreshold) return 'stalled';
  return 'zombie';
}

/**
 * Determine whether a stalled agent should receive a nudge.
 * Returns true if the nudge count is below max and enough time has passed
 * since the last nudge.
 */
export function shouldNudge(
  health: AgentHealth,
  now: Date,
  nudgeInterval: number = NUDGE_INTERVAL_S,
  maxNudges: number = MAX_NUDGES,
): boolean {
  if (health.state !== 'stalled') return false;
  if (health.nudgeCount >= maxNudges) return false;

  if (!health.lastNudge) return true;
  const elapsed = (now.getTime() - new Date(health.lastNudge).getTime()) / 1000;
  return elapsed >= nudgeInterval;
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
  launchTime: string;
  prevHealth: HealthSnapshot | null;
  now: Date;
}): HealthSnapshot {
  const { repoRoot, taskNames, syncTasks, livenessMap, launchTime, prevHealth, now } = opts;

  const agents: Record<string, AgentHealth> = {};

  for (const taskName of taskNames) {
    const taskDone = syncTasks[taskName]?.status === 'done';
    const tmuxAlive = livenessMap.get(taskName) ?? true; // assume alive if no data
    const lastActivity = readHeartbeat(repoRoot, taskName);
    const prev = prevHealth?.agents[taskName];

    const state = resolveHealthState({
      taskDone,
      tmuxAlive,
      lastActivity,
      launchTime,
      now,
      stallThreshold: STALL_THRESHOLD_S,
      zombieThreshold: ZOMBIE_THRESHOLD_S,
      bootGrace: BOOT_GRACE_S,
    });

    // Carry over escalation state from previous snapshot
    let stalledSince = prev?.stalledSince ?? null;
    let nudgeCount = prev?.nudgeCount ?? 0;
    let lastNudge = prev?.lastNudge ?? null;

    if (state === 'stalled' && prev?.state !== 'stalled') {
      // Just entered stalled — record when
      stalledSince = now.toISOString();
      nudgeCount = 0;
      lastNudge = null;
    } else if (state !== 'stalled') {
      // Not stalled — reset escalation
      stalledSince = null;
      nudgeCount = 0;
      lastNudge = null;
    }

    agents[taskName] = {
      taskName,
      state,
      lastActivity,
      stalledSince,
      nudgeCount,
      lastNudge,
    };
  }

  return { timestamp: now.toISOString(), agents };
}

// --- Heartbeat I/O ---

/** Read the last heartbeat timestamp for a task. Returns null if no heartbeat exists. */
export function readHeartbeat(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'heartbeats', taskName);
    return readFileSync(filePath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** Write a heartbeat timestamp for a task. */
export function writeHeartbeat(repoRoot: string, taskName: string): void {
  const dir = resolve(repoRoot, '.paw', 'heartbeats');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, taskName), new Date().toISOString(), 'utf-8');
}

// --- Health snapshot I/O ---

/** Read the computed health snapshot. Returns null if not yet written. */
export function readHealthSnapshot(repoRoot: string): HealthSnapshot | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'health.json');
    return JSON.parse(readFileSync(filePath, 'utf-8')) as HealthSnapshot;
  } catch {
    return null;
  }
}

/** Write the computed health snapshot (single writer: watch loop only). */
export function writeHealthSnapshot(repoRoot: string, snapshot: HealthSnapshot): void {
  const dir = resolve(repoRoot, '.paw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'health.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

// --- Nudge I/O ---

/** Write a nudge message for an agent to pick up. */
export function writeNudge(repoRoot: string, taskName: string, message: string): void {
  const dir = resolve(repoRoot, '.paw', 'nudges');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${taskName}.md`), message, 'utf-8');
}

/** Read a pending nudge for a task. Returns null if no nudge is pending. */
export function readNudge(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.paw', 'nudges', `${taskName}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Delete a nudge file after the agent has read it. */
export function clearNudge(repoRoot: string, taskName: string): void {
  try {
    rmSync(resolve(repoRoot, '.paw', 'nudges', `${taskName}.md`));
  } catch {
    // Already cleared or never existed
  }
}
