/** ZFC Health Monitoring — state machine, heartbeat I/O, and inbox cursor. */

import { mkdirSync, readFileSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import {
  STALL_THRESHOLD_S,
  ZOMBIE_THRESHOLD_S,
  NUDGE_INTERVAL_S,
  MAX_ESCALATION_LEVEL,
  TRIAGE_TIMEOUT_MS,
  TRIAGE_CAPTURE_LINES,
} from './constants.js';
import type { TmuxServiceApi } from './tmux.js';
import { emitEvent } from './feed.js';

export type HealthState = 'booting' | 'working' | 'stalled' | 'zombie' | 'completed';

const AgentHealthSchema = z.object({
  taskName: z.string(),
  state: z.enum(['booting', 'working', 'stalled', 'zombie', 'completed']),
  lastActivity: z.string().nullable(),
  stalledSince: z.string().nullable(),
  escalationLevel: z.number(),
});

export const HealthSnapshotSchema = z.object({
  timestamp: z.string(),
  agents: z.record(z.string(), AgentHealthSchema),
});

interface AgentHealth {
  taskName: string;
  state: HealthState;
  /** ISO timestamp of last tool invocation (from heartbeat file). */
  lastActivity: string | null;
  /** ISO timestamp when stall was first detected. */
  stalledSince: string | null;
  /** Progressive escalation stage: 0=warn, 1=nudge, 2=triage, 3=terminate. */
  escalationLevel: number;
}

type TriageVerdict = 'extend' | 'retry' | 'terminate';

export interface HealthSnapshot {
  timestamp: string;
  agents: Record<string, AgentHealth>;
}

/**
 * A launch heartbeat is written at spawn time, so `lastActivity` always exists.
 * The 'booting' state is handled by `evaluateAllAgents`, not here.
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
  if (Number.isNaN(activityMs)) return 'zombie';
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
    const status = syncTasks[taskName]?.status;
    const taskDone = status === 'done' || status === 'in_review';
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

/** Read the ISO timestamp from a task's heartbeat file, or null if missing. */
export function readHeartbeat(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.fleet', 'run', 'heartbeats', taskName);
    return readFileSync(filePath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** Write the current time as the task's heartbeat (called by the hook on each tool invocation). */
export function writeHeartbeat(repoRoot: string, taskName: string): void {
  const dir = resolve(repoRoot, '.fleet', 'run', 'heartbeats');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, taskName), new Date().toISOString(), 'utf-8');
}

/** Load the last persisted health snapshot, or null if none exists. */
export function readHealthSnapshot(repoRoot: string): HealthSnapshot | null {
  try {
    const filePath = resolve(repoRoot, '.fleet', 'run', 'health.json');
    return HealthSnapshotSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')));
  } catch {
    return null;
  }
}

/** Single writer: called exclusively from the watch loop. */
export function writeHealthSnapshot(repoRoot: string, snapshot: HealthSnapshot): void {
  const dir = resolve(repoRoot, '.fleet', 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'health.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

/** Read the last-seen inbox cursor for a task, used to skip already-delivered messages. */
export function readInboxCursor(repoRoot: string, taskName: string): string | null {
  try {
    const filePath = resolve(repoRoot, '.fleet', 'run', `.inbox-cursor-${taskName}`);
    return readFileSync(filePath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/** Persist the inbox cursor so future reads skip already-delivered messages. */
export function writeInboxCursor(repoRoot: string, taskName: string, cursor: string): void {
  const dir = resolve(repoRoot, '.fleet', 'run');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `.inbox-cursor-${taskName}`), cursor, 'utf-8');
}

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
    let verdict: TriageVerdict;
    if (upper.includes('TERMINATE')) verdict = 'terminate';
    else if (upper.includes('RETRY')) verdict = 'retry';
    else verdict = 'extend';
    emitEvent({ event: 'fleet.triage', task: taskName, verdict });
    return { verdict, captured };
  } catch {
    // On failure (timeout, claude not found, etc.), default to extend (safe)
    return { verdict: 'extend', captured };
  }
}

/** Persists terminal capture and verdict for post-session review. */
export function saveTriageOutput(
  repoRoot: string,
  taskName: string,
  captured: string,
  verdict: string,
  timestamp: string,
): void {
  const dir = resolve(repoRoot, '.fleet', 'run', 'triage');
  mkdirSync(dir, { recursive: true });
  const content =
    `Triage verdict: ${verdict}\n` +
    `Timestamp: ${timestamp}\n` +
    `Task: ${taskName}\n\n` +
    `--- Terminal capture ---\n${captured}\n`;
  writeFileSync(resolve(dir, `${taskName}.txt`), content, 'utf-8');
}
