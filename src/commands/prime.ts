import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { getCommitCount, getChangedFileCount } from '../lib/git.js';
import { detectTaskName, planWorktrees } from '../lib/session.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import type { SyncState } from '../lib/sync.js';
import { readSyncState, claimTask, writeSyncState, readSyncFile } from '../lib/sync.js';
import { readJournal, readJournalForTask } from '../lib/journal.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { checkAgentLiveness, createTmuxService } from '../lib/tmux.js';
import type { PawPaneConfig } from '../lib/tmux.js';
import type { PawConfig } from '../lib/config.js';
import { computeThreads } from './inbox.js';
import { readDoc, stripFrontmatter } from '../lib/docs.js';
import { ensureDocsFresh } from '../lib/doc-sync.js';
import { handleError, formatFocusAreas, colors, success } from '../lib/output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function statusColor(status: string): (text: string) => string {
  return status === 'done' ? colors.success : status === 'in_progress' ? colors.warn : colors.muted;
}

function summarizeTasks(state: SyncState): { total: number; inProgress: number; done: number } {
  const tasks = Object.values(state.tasks);
  return {
    total: tasks.length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function loadSkillContent(): string | null {
  const doc = readDoc('templates', 'skill');
  if (!doc) return null;
  return stripFrontmatter(doc.content);
}

function loadOrchestratorBriefContent(): string | null {
  const doc = readDoc('templates', 'orchestrator-brief');
  if (!doc) return null;
  return stripFrontmatter(doc.content);
}

function loadAgentBriefContent(): string | null {
  const doc = readDoc('templates', 'agent-brief');
  if (!doc) return null;
  return stripFrontmatter(doc.content);
}

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
          // Main repo — orchestrator dashboard
          if (opts.brief) {
            printOrchestratorBrief(repoRoot);
          } else {
            printOrchestratorDashboard(repoRoot);
          }
          return;
        }

        // Worktree — existing behavior
        const taskFile = resolve(repoRoot, '.paw', 'tasks', `${taskName}.md`);
        const taskContent = existsSync(taskFile) ? readFileSync(taskFile, 'utf-8') : null;

        const state = readSyncState(repoRoot);
        const updated = state && state.tasks[taskName] ? claimTask(state, taskName) : null;
        if (updated) writeSyncState(updated, repoRoot);

        if (opts.brief) {
          printBrief(taskName, taskContent, updated, repoRoot);
        } else {
          printFull(taskName, taskContent, updated, repoRoot);
        }
      } catch (err) {
        handleError(err);
      }
    });
}

/** Orchestrator dashboard — shown when prime runs in the main repo. */
function printOrchestratorDashboard(repoRoot: string): void {
  const version = getVersion();
  console.log(`paw v${version}\n`);

  // Installation status
  console.log('=== INSTALLATION ===');
  success('paw installed', `v${version}`);

  const pawDir = resolve(repoRoot, '.paw');
  const settingsPath = resolve(repoRoot, '.claude', 'settings.json');
  if (existsSync(pawDir)) {
    success('Set up in this repo', '');
  } else {
    console.log(colors.warn('  paw not set up — run `paw init`'));
  }
  if (existsSync(settingsPath)) {
    success('Hooks installed', '');
  }

  // Session status
  console.log('\n=== SESSION STATUS ===');
  const yamlPath = resolve(repoRoot, '.paw', 'paw.yaml');
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
      console.log(pc.dim('  Run `paw shortcut generate-paw-yaml` to plan a session'));
    } else {
      console.log('Session configured (.paw/paw.yaml found) — run `paw up` to start');
    }
  } else {
    console.log('No active session (.paw/paw.yaml not found)');
    console.log(pc.dim('  Run `paw shortcut generate-paw-yaml` to plan a session'));
  }

  // Full skill content
  const skillContent = loadSkillContent();
  if (skillContent) {
    console.log('');
    console.log(skillContent);
  }
}

/** Brief orchestrator output — dynamic status + orchestrator-brief content. */
function printOrchestratorBrief(repoRoot: string): void {
  const version = getVersion();
  console.log(`paw v${version}`);

  const state = readSyncState(repoRoot);
  if (state) {
    const { total, inProgress, done } = summarizeTasks(state);
    console.log(`Session: ${total} tasks (${inProgress} in_progress, ${done} done)`);
  } else {
    console.log('No active session');
  }

  // Embed status snapshot when there's an active session with agents
  const paneConfig = readPaneConfig(repoRoot);
  if (paneConfig && state) {
    printStatusSnapshot(repoRoot, state, paneConfig);
  }

  // Orchestrator brief content
  const briefContent = loadOrchestratorBriefContent();
  if (briefContent) {
    console.log('');
    console.log(briefContent);
  }
}

/** Print a compact status snapshot for the orchestrator brief (PreCompact). */
function printStatusSnapshot(repoRoot: string, state: SyncState, paneConfig: PawPaneConfig): void {
  // Check tmux liveness
  const livenessMap = new Map<string, boolean>();
  try {
    const tmux = createTmuxService();
    const results = checkAgentLiveness(tmux, paneConfig);
    for (const r of results) {
      livenessMap.set(r.taskName, r.alive);
    }
  } catch {
    // tmux not available
  }

  let configObj: PawConfig | undefined;
  try {
    const configPath = resolveConfigPath(repoRoot);
    configObj = loadConfig(configPath);
  } catch {
    // config not loadable
  }

  console.log('\n=== Agent Status ===');
  for (const [name, task] of Object.entries(state.tasks)) {
    const alive = livenessMap.get(name);
    const marker = alive === true ? pc.green('●') : alive === false ? pc.red('○') : ' ';
    const focus = formatFocusAreas(task.focus);
    const focusSuffix = focus ? `  ${focus}` : '';

    if (task.status === 'done') {
      console.log(`  ${marker} ${name} -- done`);
      continue;
    }

    // Try to get commit count
    let commitInfo = '';
    if (configObj) {
      try {
        const worktrees = planWorktrees(configObj, repoRoot);
        const wt = worktrees.find((w) => w.taskName === name);
        if (wt) {
          const commits = getCommitCount(wt.branch, configObj.target, repoRoot);
          const files =
            commits > 0 ? getChangedFileCount(wt.branch, configObj.target, repoRoot) : 0;
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
  console.log(pc.bold(`paw prime: ${taskName} (brief)\n`));

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
    console.log(pc.dim('No sync state found. Run `paw up` first.\n'));
  }

  // Show unanswered threads directed at this agent (actionable on compaction recovery)
  const allEntries = readJournal(repoRoot);
  const { open } = computeThreads(allEntries);
  const unanswered = open.filter((t) => t.ask.to === taskName);
  if (unanswered.length > 0) {
    console.log(pc.bold('Unanswered Messages'));
    for (const { ask } of unanswered) {
      console.log(`  ${colors.info(`[${ask.from} → ${taskName}]`)} ${ask.msg}`);
    }
    console.log();
  }

  // Agent brief content
  const briefContent = loadAgentBriefContent();
  if (briefContent) {
    console.log('');
    console.log(briefContent);
  }
}

/** Updates the `lastCheck` cursor so the next prime skips already-seen messages. */
function printFull(
  taskName: string,
  taskContent: string | null,
  state: SyncState | null,
  repoRoot: string,
): void {
  console.log(pc.bold(`paw prime: ${taskName}\n`));

  if (taskContent) {
    console.log(taskContent);
  } else {
    console.log(colors.warn('No task file found.\n'));
  }

  if (!state) {
    console.log(pc.dim('No sync state found. Run `paw up` first.\n'));
    return;
  }

  console.log(colors.success(`Claimed task: ${taskName}\n`));

  const separator = pc.dim('────────────────────────────────────────');

  // Team status
  console.log(separator);
  printTeamStatus(taskName, state);

  // Recent broadcasts and directed messages
  const lastCheck = state.lastCheck?.[taskName];
  const entries = readJournalForTask(taskName, repoRoot, lastCheck);
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

  const now = new Date().toISOString();
  writeSyncState({ ...state, lastCheck: { ...state.lastCheck, [taskName]: now } }, repoRoot);

  // Done summaries
  const doneTasks = Object.entries(state.tasks).filter(
    ([name, task]) => name !== taskName && task.status === 'done',
  );
  if (doneTasks.length > 0) {
    console.log(separator);
    console.log(pc.bold('Done Summaries\n'));
    for (const [name] of doneTasks) {
      const summary = readSyncFile(`summaries/${name}.md`, repoRoot);
      if (summary) {
        console.log(pc.bold(`### ${name}`));
        console.log(summary);
        console.log();
      }
    }
  }

  // Active conflict brief
  if (state.merges) {
    const conflictEntries = Object.entries(state.merges).filter(
      ([, entry]) => entry.status === 'conflict' && entry.brief,
    );
    if (conflictEntries.length > 0) {
      console.log(separator);
      console.log(pc.bold(colors.warn('Active Conflict\n')));
      for (const [name, entry] of conflictEntries) {
        const brief = readSyncFile(entry.brief!, repoRoot);
        if (brief) {
          console.log(brief);
        } else {
          console.log(colors.warn(`Conflict on ${name} — brief at ${entry.brief}`));
        }
      }
    }
  }

  // Workflow footer
  console.log(pc.dim('── Workflow ──'));
  console.log(pc.dim('1. Follow `paw shortcut precommit-process` when committing'));
  console.log(pc.dim('2. Run `paw broadcast "..."` when you change shared interfaces'));
  console.log(pc.dim('3. Run `paw inbox --all` to see open Q&A threads'));
  console.log(pc.dim('4. Run `paw done` with a structured summary when finished'));

  // Full skill content
  const skillContent = loadSkillContent();
  if (skillContent) {
    console.log('');
    console.log(skillContent);
  }
}
