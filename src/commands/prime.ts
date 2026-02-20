import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import type { SyncState } from '../lib/sync.js';
import { readSyncState, claimTask, writeSyncState, readSyncFile } from '../lib/sync.js';
import { readJournalForTask } from '../lib/journal.js';
import { handleError, formatFocusAreas } from '../lib/output.js';

export function primeCommand(): Command {
  return new Command('prime')
    .description('Orient agent and claim task (run inside a worktree)')
    .option('--brief', 'Condensed output for hooks and constrained contexts')
    .action((opts: { brief?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(
            pc.red('Error: paw prime is an agent command — you are not inside a worktree.'),
          );
          console.error('');
          console.error('To start agents in their worktrees:');
          console.error('  paw launch      # opens terminals and starts agents automatically');
          console.error('');
          console.error('Or manually:');
          console.error('  cd .paw/worktrees/<task-name>');
          console.error('  paw prime');
          process.exit(1);
          return;
        }

        // Read task file content
        const taskFile = resolve(repoRoot, '.paw', 'tasks', `${taskName}.md`);
        const taskContent = existsSync(taskFile) ? readFileSync(taskFile, 'utf-8') : null;

        // Claim on sync branch
        const state = readSyncState(repoRoot);
        const updated = state && state.tasks[taskName] ? claimTask(state, taskName) : null;
        if (updated) writeSyncState(updated, repoRoot);

        if (opts.brief) {
          printBrief(taskName, taskContent, updated);
        } else {
          printFull(taskName, taskContent, updated, repoRoot);
        }
      } catch (err) {
        handleError(err);
      }
    });
}

function printTeamStatus(taskName: string, state: SyncState): void {
  const otherTasks = Object.entries(state.tasks).filter(([name]) => name !== taskName);
  if (otherTasks.length === 0) return;

  console.log(pc.bold('Team Status'));
  for (const [name, task] of otherTasks) {
    const statusColor =
      task.status === 'done' ? pc.green : task.status === 'in_progress' ? pc.yellow : pc.dim;
    const focus = formatFocusAreas(task.focus);
    const focusSuffix = focus ? `  ${pc.dim(focus)}` : '';
    console.log(`  ${statusColor(task.status.padEnd(12))} ${name}${focusSuffix}`);
  }
  console.log();
}

function printBrief(taskName: string, taskContent: string | null, state: SyncState | null): void {
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

  console.log(pc.dim('Commands: paw threads | paw broadcast | paw done'));
  console.log(pc.dim('Full context: paw prime'));
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
    console.log(pc.yellow('No task file found.\n'));
  }

  if (!state) {
    console.log(pc.dim('No sync state found. Run `paw up` first.\n'));
    return;
  }

  console.log(pc.green(`Claimed task: ${taskName}\n`));

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
      console.log(`  ${pc.cyan(`[${entry.from} → ${taskName}]`)} ${entry.msg}`);
    }
    console.log();
  }

  // Update last-check cursor so next prime run skips already-seen messages
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
      console.log(pc.bold(pc.yellow('Active Conflict\n')));
      for (const [name, entry] of conflictEntries) {
        const brief = readSyncFile(entry.brief!, repoRoot);
        if (brief) {
          console.log(brief);
        } else {
          console.log(pc.yellow(`Conflict on ${name} — brief at ${entry.brief}`));
        }
      }
    }
  }

  // Workflow footer
  console.log(pc.dim('── Workflow ──'));
  console.log(pc.dim('1. Follow `paw shortcut precommit-process` when committing'));
  console.log(pc.dim('2. Run `paw broadcast "..."` when you change shared interfaces'));
  console.log(pc.dim('3. Run `paw threads` to see open Q&A threads'));
  console.log(pc.dim('4. Run `paw shortcut session-end` when finished'));
}
