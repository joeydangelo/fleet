import { readMessages } from './messages.js';
import { getMergeConflictDiff, getConflictingFiles } from './git.js';
import type { SyncState } from './sync.js';
import { readSyncFile, reviewFilePath } from './sync.js';

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

/** Read the builder's summary from the sync branch. Returns null if not found. */
function getTaskSummary(branch: string, cwd: string): string | null {
  return readSyncFile(reviewFilePath(branch), cwd);
}

/**
 * Generate a conflict brief assembling context from PR descriptions, inbox, and diff.
 * Written to conflicts/{taskName}-into-target.md on the sync branch.
 */
export function generateConflictBrief(opts: ConflictBriefOpts): string {
  const { conflictingTask, target, state, cwd } = opts;

  const lines: string[] = [];

  lines.push(`# Merge Conflict: ${conflictingTask} into ${target}`);
  lines.push('');

  const conflictFiles = getConflictingFiles(cwd);
  if (conflictFiles.length > 0) {
    lines.push('## Conflicting files');
    for (const file of conflictFiles) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  const mergedTasks = Object.entries(state.merges).filter(
    ([name, entry]) => name !== conflictingTask && entry.status === 'merged',
  );

  if (mergedTasks.length > 0) {
    lines.push('## Already merged (in target)');
    for (const [name, entry] of mergedTasks) {
      lines.push(
        `${name} -- merged clean${entry.status === 'merged' ? ` at ${entry.merged}` : ''}`,
      );
    }
    lines.push('');
  }

  const conflictBranch = `${target}-${conflictingTask}`;
  const conflictSummary = getTaskSummary(conflictBranch, cwd);
  lines.push(`## Task being merged: ${conflictingTask}`);
  if (conflictSummary) {
    lines.push(conflictSummary);
  } else {
    lines.push('*No builder summary available.*');
  }
  lines.push('');

  for (const [name] of mergedTasks) {
    const branch = `${target}-${name}`;
    const summary = getTaskSummary(branch, cwd);
    if (summary) {
      lines.push(`## Task already in target: ${name}`);
      lines.push(summary);
      lines.push('');
    }
  }

  const diffOutput = getMergeConflictDiff(cwd);
  if (diffOutput) {
    lines.push('## The conflict diff');
    lines.push('```');
    lines.push(diffOutput);
    lines.push('```');
    lines.push('');
  }

  const messages = readMessages(cwd);
  const relevantTasks = new Set<string>([conflictingTask]);
  for (const [name, entry] of Object.entries(state.merges)) {
    if (entry.status === 'merged') {
      relevantTasks.add(name);
    }
  }

  const relevantEntries = messages.filter(
    (e) => relevantTasks.has(e.from) || (e.to && relevantTasks.has(e.to)),
  );

  if (relevantEntries.length > 0) {
    lines.push('## Relevant inbox entries');
    for (const entry of relevantEntries) {
      const recipient = entry.to ? ` → ${entry.to}` : ' → all';
      lines.push(`- [${entry.from}${recipient}] ${entry.msg}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
