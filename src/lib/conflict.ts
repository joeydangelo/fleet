import { execFileSync } from 'node:child_process';
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

/** Returns null if gh CLI fails or no PR exists. */
function getPrBody(branch: string, cwd: string): string | null {
  try {
    const raw = execFileSync('gh', ['pr', 'view', branch, '--json', 'body', '-q', '.body'], {
      cwd,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    const body = raw.trim();
    return body || null;
  } catch {
    return null;
  }
}

/**
 * Generate a conflict brief assembling context from PR descriptions, journal, and diff.
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

  const mergedTasks = state.merges
    ? Object.entries(state.merges).filter(
        ([name, entry]) => name !== conflictingTask && entry.status === 'merged',
      )
    : [];

  if (mergedTasks.length > 0) {
    lines.push('## Already merged (in target)');
    for (const [name, entry] of mergedTasks) {
      lines.push(`${name} -- merged clean${entry.merged ? ` at ${entry.merged}` : ''}`);
    }
    lines.push('');
  }

  const conflictBranch = `${target}-${conflictingTask}`;
  const conflictPr = getPrBody(conflictBranch, cwd);
  lines.push(`## Task being merged: ${conflictingTask}`);
  if (conflictPr) {
    lines.push(conflictPr);
  } else {
    lines.push('*No PR description available.*');
  }
  lines.push('');

  for (const [name] of mergedTasks) {
    const branch = `${target}-${name}`;
    const prBody = getPrBody(branch, cwd);
    if (prBody) {
      lines.push(`## Task already in target: ${name}`);
      lines.push(prBody);
      lines.push('');
    }
  }

  const diffOutput = getDiffOutput(cwd);
  if (diffOutput) {
    lines.push('## The conflict diff');
    lines.push('```');
    lines.push(diffOutput);
    lines.push('```');
    lines.push('');
  }

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
