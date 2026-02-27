import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot, resolveMainRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readNudge, clearNudge, readInboxCursor, writeInboxCursor } from '../lib/health.js';
import { readJournal, readJournalForTask } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

// --- Thread computation (moved from threads.ts) ---

/** Journal entry that carries a thread identifier. */
type ThreadedEntry = JournalEntry & { thread: string };

function hasThread(e: JournalEntry): e is ThreadedEntry {
  return typeof (e as unknown as { thread?: unknown }).thread === 'string';
}

export interface OpenThread {
  ask: ThreadedEntry;
}

export interface ResolvedThread {
  ask: ThreadedEntry;
  reply: ThreadedEntry;
}

export interface ThreadResult {
  open: OpenThread[];
  resolved: ResolvedThread[];
  broadcasts: JournalEntry[];
}

/**
 * Compute open threads, resolved threads, and broadcasts from journal entries.
 * Open: ask entries with a thread value that have no matching reply.
 * Resolved: ask entries with a matching reply (same thread value).
 * Broadcasts: entries with type === 'broadcast'.
 * Entries without a thread field (other than broadcasts) are skipped.
 */
export function computeThreads(entries: JournalEntry[]): ThreadResult {
  const asks = entries.filter((e): e is ThreadedEntry => e.type === 'ask' && hasThread(e));
  const replyByThread = new Map<string, ThreadedEntry>();
  const broadcasts = entries.filter((e) => e.type === 'broadcast');

  for (const e of entries) {
    if (e.type === 'reply' && hasThread(e)) {
      replyByThread.set(e.thread, e);
    }
  }

  const open: OpenThread[] = [];
  const resolved: ResolvedThread[] = [];

  for (const ask of asks) {
    const reply = replyByThread.get(ask.thread);
    if (reply) {
      resolved.push({ ask, reply });
    } else {
      open.push({ ask });
    }
  }

  return { open, resolved, broadcasts };
}

// --- Entry formatting ---

function formatJournalEntry(entry: JournalEntry): string {
  if (entry.type === 'broadcast') {
    return `[${entry.from}] broadcast: ${entry.msg}`;
  }
  if (entry.to) {
    return `[${entry.from} → ${entry.to}] ${entry.msg}`;
  }
  return `[${entry.from}] ${entry.msg}`;
}

// --- Command ---

export function inboxCommand(): Command {
  return new Command('inbox')
    .description('Check for messages, broadcasts, and open threads')
    .option('-a, --all', 'Show all threads (open and resolved)')
    .action((opts: { all?: boolean }) => {
      try {
        const cwd = process.cwd();
        const taskName = detectTaskName(cwd);

        // --all mode: full unfiltered view (replaces `paw threads`)
        if (opts.all) {
          showAllThreads();
          return;
        }

        // Default hook mode: incremental per-task inbox
        if (!taskName) return;
        const mainRoot = resolveMainRoot(cwd);

        // Read nudge file
        const nudge = readNudge(mainRoot, taskName);
        if (nudge) {
          console.log(`\n[paw] Message from orchestrator:\n${nudge}\n`);
          clearNudge(mainRoot, taskName);
        }

        // Read journal entries since last cursor
        const cursor = readInboxCursor(mainRoot, taskName);
        const entries = readJournalForTask(taskName, cwd, cursor ?? undefined);

        // Filter out own broadcasts (agent doesn't need to see its own messages)
        const relevant = entries.filter((e) => e.from !== taskName);

        if (relevant.length > 0) {
          console.log(`\n[paw] ${relevant.length} new message(s) from other agents:`);
          for (const entry of relevant) {
            console.log(`  ${formatJournalEntry(entry)}`);
          }
          console.log();
        }

        // Check for unanswered threads directed at this agent
        const allEntries = readJournal(cwd);
        const { open } = computeThreads(allEntries);
        const unanswered = open.filter((t) => t.ask.to === taskName);
        if (unanswered.length > 0) {
          console.log(`[paw] ${unanswered.length} unanswered question(s):`);
          for (const { ask } of unanswered) {
            const id = ask.thread.slice(0, 4);
            console.log(`  (${id}) ${ask.from} → ${ask.to}: "${ask.msg}"`);
          }
          console.log(`  Reply with: paw reply "your answer"\n`);
        }

        // Update cursor to latest entry timestamp (use all entries, not just relevant)
        if (entries.length > 0) {
          const latestTs = entries[entries.length - 1]!.ts;
          writeInboxCursor(mainRoot, taskName, latestTs);
        }
      } catch {
        // Hooks must not crash the agent — swallow all errors
      }
    });
}

/** Full unfiltered view of all broadcasts, open threads, and resolved threads. */
function showAllThreads(): void {
  try {
    const repoRoot = getRepoRoot();
    const entries = readJournal(repoRoot);
    const { open, resolved, broadcasts } = computeThreads(entries);

    const hasContent = broadcasts.length > 0 || open.length > 0;

    // Broadcasts — informational, no reply needed
    if (broadcasts.length > 0) {
      console.log(pc.bold('Broadcasts'));
      for (const b of broadcasts) {
        console.log(`  ${pc.dim(b.from + ' →')} ${b.msg}`);
      }
    }

    // Open threads — reply needed
    if (open.length > 0) {
      if (broadcasts.length > 0) console.log('');
      console.log(pc.bold('Open threads') + pc.dim(' (reply needed)'));
      for (const { ask } of open) {
        const id = ask.thread.slice(0, 4);
        console.log(`  ${pc.dim(`(${id})`)} ${ask.from} → ${ask.to}  "${ask.msg}"`);
      }
    }

    if (broadcasts.length === 0 && open.length === 0) {
      console.log('No broadcasts or open threads.');
    }
    if (resolved.length > 0) {
      if (hasContent) console.log('');
      console.log(pc.bold('Resolved threads'));
      for (const { ask, reply } of resolved) {
        const id = ask.thread.slice(0, 4);
        console.log(`  ${pc.dim(`(${id})`)} ${ask.from} → ${ask.to}  "${ask.msg}"`);
        console.log(`       └─ ${reply.from}: "${reply.msg}"`);
      }
    }
  } catch (err) {
    handleError(err);
  }
}
