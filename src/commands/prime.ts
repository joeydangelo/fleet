import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { getVersion } from '../lib/version.js';
import { getWorktreeProgress } from '../lib/worktree-stats.js';
import { detectTaskName, planWorktrees } from '../lib/session.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import type { SyncState } from '../lib/sync.js';
import { readSyncState, claimTaskAtomic, updateLastCheck, readSyncFile } from '../lib/sync.js';
import { readMessagesForTask, getUnansweredThreadsForTask } from '../lib/messages.js';
import { readPaneConfig } from '../lib/pane-state.js';
import type { FleetPaneConfig } from '../lib/tmux.js';
import { livenessMarker } from '../lib/tmux.js';
import { tryGetLivenessMap } from '../lib/util.js';
import type { FleetConfig } from '../lib/config.js';
import { ensureDocsFresh } from '../lib/doc-sync.js';
import {
  handleError,
  formatFocusAreas,
  colors,
  success,
  warn,
  formatTaskStatus,
  toErrorMessage,
} from '../lib/output.js';

function statusColor(status: string): (text: string) => string {
  if (status === 'done') return colors.success;
  if (status === 'in_review') return colors.info;
  if (status === 'in_progress') return colors.warn;
  return colors.muted;
}

function summarizeTasks(state: SyncState): { total: number; inProgress: number; done: number } {
  const tasks = Object.values(state.tasks);
  return {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };
}

/** Build the `fleet prime` CLI command. */
export function primeCommand(): Command {
  return new Command('prime')
    .description('Context management — orchestrator dashboard or worktree orientation')
    .option('--brief', 'Condensed output for hooks and constrained contexts')
    .action(async (opts: { brief?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        await ensureDocsFresh(repoRoot).catch(() => {});
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          if (opts.brief) {
            printOrchestratorBrief(repoRoot);
          } else {
            printOrchestratorDashboard(repoRoot);
          }
          return;
        }

        const taskFile = resolve(repoRoot, '.fleet', 'tasks', `${taskName}.md`);
        const taskContent = existsSync(taskFile) ? readFileSync(taskFile, 'utf-8') : null;

        try {
          claimTaskAtomic(taskName, repoRoot);
        } catch (err) {
          warn(
            taskName,
            `Task claim failed to persist to git: ${toErrorMessage(err)}. Dashboard may show this task as pending.`,
          );
        }
        const state = readSyncState(repoRoot);

        if (opts.brief) {
          printBrief(taskName, taskContent, state, repoRoot);
        } else {
          printFull(taskName, taskContent, state, repoRoot);
        }
      } catch (err) {
        handleError(err);
      }
    });
}

/** Orchestrator dashboard — shown when prime runs in the main repo. */
function printOrchestratorDashboard(repoRoot: string): void {
  const version = getVersion();
  console.log(`fleet v${version}\n`);

  console.log('=== INSTALLATION ===');
  success('fleet installed', `v${version}`);

  const fleetDir = resolve(repoRoot, '.fleet');
  const settingsPath = resolve(repoRoot, '.claude', 'settings.json');
  if (existsSync(fleetDir)) {
    success('Set up in this repo', '');
  } else {
    console.log(colors.warn('  fleet not set up — run `fleet init`'));
  }
  if (existsSync(settingsPath)) {
    success('Hooks installed', '');
  }

  console.log('\n=== SESSION STATUS ===');
  const yamlPath = resolve(repoRoot, '.fleet', 'fleet.yaml');
  const state = readSyncState(repoRoot);
  if (state) {
    const { total, inProgress, done } = summarizeTasks(state);
    console.log(
      `Active session — target: ${state.target}, tasks: ${total} (${inProgress} in_progress, ${done} done)`,
    );

    for (const [name, task] of Object.entries(state.tasks)) {
      const focus = formatFocusAreas(task.focus);
      const focusSuffix = focus ? `  ${pc.dim(focus)}` : '';
      console.log(`  ${statusColor(task.status)(task.status.padEnd(12))} ${name}${focusSuffix}`);
    }
  } else if (existsSync(yamlPath)) {
    const yamlContent = readFileSync(yamlPath, 'utf-8');
    if (yamlContent.includes('target: feature/my-feature')) {
      // Template default — not a real config
      console.log('No active session');
    } else {
      console.log('Session configured (.fleet/fleet.yaml found) — run `fleet go` to start');
    }
  } else {
    console.log('No active session (.fleet/fleet.yaml not found)');
  }
}

/** Brief orchestrator output — dynamic session status snapshot. */
function printOrchestratorBrief(repoRoot: string): void {
  const version = getVersion();
  console.log(`fleet v${version}`);

  const state = readSyncState(repoRoot);
  if (state) {
    const { total, inProgress, done } = summarizeTasks(state);
    console.log(`Session: ${total} tasks (${inProgress} in_progress, ${done} done)`);
  } else {
    console.log('No active session');
  }

  const paneConfig = readPaneConfig(repoRoot);
  if (paneConfig && state) {
    printStatusSnapshot(repoRoot, state, paneConfig);
  }
}

/** Print a compact status snapshot for the orchestrator brief (PreCompact). */
function printStatusSnapshot(
  repoRoot: string,
  state: SyncState,
  paneConfig: FleetPaneConfig,
): void {
  const livenessMap = tryGetLivenessMap(paneConfig);

  let configObj: FleetConfig | undefined;
  try {
    const configPath = resolveConfigPath(repoRoot);
    configObj = loadConfig(configPath);
  } catch {
    // config not loadable
  }

  console.log('\n=== Agent Status ===');
  for (const [name, task] of Object.entries(state.tasks)) {
    const alive = livenessMap.get(name);
    const marker = livenessMarker(alive);
    const focus = formatFocusAreas(task.focus);
    const focusSuffix = focus ? `  ${focus}` : '';

    if (task.status === 'done' || task.status === 'in_review') {
      console.log(`  ${marker} ${name} -- ${formatTaskStatus(task.status)}`);
      continue;
    }

    let commitInfo = '';
    if (configObj) {
      try {
        const worktrees = planWorktrees(configObj, repoRoot);
        const wt = worktrees.find((w) => w.taskName === name);
        if (wt) {
          const { commits, files } = getWorktreeProgress(wt.branch, configObj.target, repoRoot);
          commitInfo = commits > 0 ? `${commits} commit(s), ${files} file(s)` : 'no changes yet';
        }
      } catch {
        commitInfo = 'unable to read';
      }
    }

    const statusLabel = task.status === 'in_progress' ? ' [claimed]' : '';
    console.log(`  ${marker} ${name} -- ${commitInfo}${statusLabel}${focusSuffix}`);
  }
}

function printTeamStatus(taskName: string, state: SyncState): void {
  const otherTasks = Object.entries(state.tasks)
    .filter(([name]) => name !== taskName)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (otherTasks.length === 0) return;

  console.log(pc.bold('Team Status'));
  for (const [name, task] of otherTasks) {
    const focus = formatFocusAreas(task.focus);
    const focusSuffix = focus ? `  ${pc.dim(focus)}` : '';
    console.log(`  ${statusColor(task.status)(task.status.padEnd(12))} ${name}${focusSuffix}`);
  }
  console.log();
}

function printBrief(
  taskName: string,
  taskContent: string | null,
  state: SyncState | null,
  repoRoot: string,
): void {
  console.log(pc.bold(`fleet prime: ${taskName} (brief)\n`));

  if (taskContent) {
    // Extract just focus and instructions sections, skip full markdown
    const lines = taskContent.split('\n');
    const focusStart = lines.findIndex((l) => l.startsWith('## Focus'));
    const instructionsStart = lines.findIndex((l) => l.startsWith('## Instructions'));

    if (focusStart !== -1) {
      const end = instructionsStart !== -1 ? instructionsStart : lines.length;
      const focusLines = lines.slice(focusStart, end).filter((l) => l.trim());
      for (const line of focusLines) console.log(line);
      console.log();
    }
  }

  if (state) {
    printTeamStatus(taskName, state);
  } else {
    console.log(pc.dim('No sync state found. Run `fleet up` first.\n'));
  }

  // Unanswered threads must survive compaction — re-surface them here
  const unanswered = getUnansweredThreadsForTask(taskName, repoRoot);
  if (unanswered.length > 0) {
    console.log(pc.bold('Unanswered Messages'));
    for (const { send } of unanswered) {
      console.log(`  ${colors.info(`[${send.from} → ${taskName}]`)} ${send.msg}`);
    }
    console.log();
  }
}

/** Updates the `lastCheck` cursor so the next prime skips already-seen messages. */
function printFull(
  taskName: string,
  taskContent: string | null,
  state: SyncState | null,
  repoRoot: string,
): void {
  console.log(pc.bold(`fleet prime: ${taskName}\n`));

  if (taskContent) {
    console.log(taskContent);
  } else {
    console.log(colors.warn('No task file found.\n'));
  }

  if (!state) {
    console.log(pc.dim('No sync state found. Run `fleet up` first.\n'));
    return;
  }

  console.log(colors.success(`Claimed task: ${taskName}`));

  const separator = pc.dim('────────────────────────────────────────');

  console.log(separator);
  printTeamStatus(taskName, state);

  const lastCheck = state.lastCheck[taskName];
  const entries = readMessagesForTask(taskName, repoRoot, lastCheck);
  const broadcasts = entries.filter((e) => e.type === 'broadcast' && e.from !== taskName);
  const directed = entries.filter((e) => e.to === taskName);

  if (broadcasts.length > 0) {
    console.log(separator);
    console.log(pc.bold('Recent Broadcasts'));
    for (const entry of broadcasts) {
      console.log(`  ${pc.dim(`[${entry.from}]`)} ${entry.msg}`);
    }
    console.log();
  }

  if (directed.length > 0) {
    console.log(separator);
    console.log(pc.bold('Messages for You'));
    for (const entry of directed) {
      console.log(`  ${colors.info(`[${entry.from} → ${taskName}]`)} ${entry.msg}`);
    }
    console.log();
  }

  try {
    updateLastCheck(taskName, repoRoot);
  } catch {
    // Non-fatal — cursor will catch up on next prime
  }

  const conflictEntries = Object.entries(state.merges).filter(
    ([, entry]) => entry.status === 'conflict',
  );
  if (conflictEntries.length > 0) {
    console.log(separator);
    console.log(pc.bold(colors.warn('Active Conflict\n')));
    for (const [name, entry] of conflictEntries) {
      if (entry.status !== 'conflict') continue;
      const brief = readSyncFile(entry.brief, repoRoot);
      if (brief) {
        console.log(brief);
      } else {
        console.log(colors.warn(`Conflict on ${name} — brief not available`));
      }
    }
  }
}
