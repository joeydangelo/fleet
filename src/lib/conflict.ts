import { readSyncFile } from './sync.js';
import { readJournal } from './journal.js';
import { getDiffOutput, getConflictingFiles } from './git.js';
import type { SyncState } from './sync.js';

interface ConflictBriefOpts {
  /** The task being merged that caused the conflict. */
  conflictingTask: string;
  /** The target branch name. */
  target: string;
  /** Sync state with merge entries. */
  state: SyncState;
  /** Working directory (repo root). */
  cwd: string;
}

/**
 * Generate a conflict brief assembling context from summaries, journal, and diff.
 * Written to conflicts/{taskName}-into-target.md on the sync branch.
 */
export function generateConflictBrief(opts: ConflictBriefOpts): string {
  const { conflictingTask, target, state, cwd } = opts;

  const lines: string[] = [];

  // Header
  lines.push(`# Merge Conflict: ${conflictingTask} into ${target}`);
  lines.push('');

  // Conflicting files
  const conflictFiles = getConflictingFiles(cwd);
  if (conflictFiles.length > 0) {
    lines.push('## Conflicting files');
    for (const file of conflictFiles) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  // Compute merged tasks once
  const mergedTasks = state.merges
    ? Object.entries(state.merges).filter(
        ([name, entry]) => name !== conflictingTask && entry.status === 'merged',
      )
    : [];

  // Already merged tasks
  if (mergedTasks.length > 0) {
    lines.push('## Already merged (in target)');
    for (const [name, entry] of mergedTasks) {
      lines.push(`${name} -- merged clean${entry.merged ? ` at ${entry.merged}` : ''}`);
    }
    lines.push('');
  }

  // Summary for the conflicting task
  const conflictSummary = readSyncFile(`summaries/${conflictingTask}.md`, cwd);
  lines.push(`## Task being merged: ${conflictingTask}`);
  if (conflictSummary) {
    lines.push(conflictSummary);
  } else {
    lines.push('*No summary available.*');
  }
  lines.push('');

  // Summaries for already-merged tasks
  for (const [name] of mergedTasks) {
    const summary = readSyncFile(`summaries/${name}.md`, cwd);
    if (summary) {
      lines.push(`## Task already in target: ${name}`);
      lines.push(summary);
      lines.push('');
    }
  }

  // The conflict diff
  const diffOutput = getDiffOutput(cwd);
  if (diffOutput) {
    lines.push('## The conflict diff');
    lines.push('```');
    lines.push(diffOutput);
    lines.push('```');
    lines.push('');
  }

  // Relevant journal entries
  const journal = readJournal(cwd);
  const relevantTasks = new Set<string>([conflictingTask]);
  if (state.merges) {
    for (const [name, entry] of Object.entries(state.merges)) {
      if (entry.status === 'merged') {
        relevantTasks.add(name);
      }
    }
  }

  const relevantEntries = journal.filter(
    (e) => relevantTasks.has(e.from) || (e.to && relevantTasks.has(e.to)),
  );

  if (relevantEntries.length > 0) {
    lines.push('## Relevant journal entries');
    for (const entry of relevantEntries) {
      const recipient = entry.to ? ` → ${entry.to}` : ' → all';
      lines.push(`- [${entry.from}${recipient}] ${entry.msg}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
