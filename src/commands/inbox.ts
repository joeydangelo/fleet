import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot, resolveMainRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readNudge, clearNudge, readInboxCursor, writeInboxCursor } from '../lib/health.js';
import { readJournal, readJournalForTask } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

/** Journal entry that carries a thread identifier. */
type ThreadedEntry = JournalEntry & { thread: string };

function hasThread(e: JournalEntry): e is ThreadedEntry {
  return typeof (e as unknown as { thread?: unknown }).thread === 'string';
}

/** A directed message awaiting a reply. */
export interface OpenThread {
  send: ThreadedEntry;
}

/** A directed message that has been answered. */
export interface ResolvedThread {
  send: ThreadedEntry;
  reply: ThreadedEntry;
}

/** Categorised journal entries: open threads, resolved threads, and broadcasts. */
export interface ThreadResult {
  open: OpenThread[];
  resolved: ResolvedThread[];
  broadcasts: JournalEntry[];
}

/**
 * Compute open threads, resolved threads, and broadcasts from journal entries.
 * Open: send entries with a thread value that have no matching reply.
 * Resolved: send entries with a matching reply (same thread value).
 * Broadcasts: entries with type === 'broadcast'.
 * Entries without a thread field (other than broadcasts) are skipped.
 */
export function computeThreads(entries: JournalEntry[]): ThreadResult {
  const sends = entries.filter((e): e is ThreadedEntry => e.type === 'send' && hasThread(e));
  const replyByThread = new Map<string, ThreadedEntry>();
  const broadcasts = entries.filter((e) => e.type === 'broadcast');

  for (const e of entries) {
    if (e.type === 'reply' && hasThread(e)) {
      replyByThread.set(e.thread, e);
    }
  }

  const open: OpenThread[] = [];
  const resolved: ResolvedThread[] = [];

  for (const send of sends) {
    const reply = replyByThread.get(send.thread);
    if (reply) {
      resolved.push({ send, reply });
    } else {
      open.push({ send });
    }
  }

  return { open, resolved, broadcasts };
}

function formatJournalEntry(entry: JournalEntry): string {
  if (entry.type === 'broadcast') {
    return `[${entry.from}] broadcast: ${entry.msg}`;
  }
  if (entry.to) {
    return `[${entry.from} → ${entry.to}] ${entry.msg}`;
  }
  return `[${entry.from}] ${entry.msg}`;
}

/** CLI command: show new messages, unanswered threads, and broadcasts for an agent. */
export function inboxCommand(): Command {
  return new Command('inbox')
    .description('Check for messages, broadcasts, and open threads')
    .option('-a, --all', 'Show all threads (open and resolved)')
    .action((opts: { all?: boolean }) => {
      try {
        const cwd = process.cwd();
        const taskName = detectTaskName(cwd);

        if (opts.all) {
          showAllThreads();
          return;
        }

        if (!taskName) return;
        const mainRoot = resolveMainRoot(cwd);

        const nudge = readNudge(mainRoot, taskName);
        if (nudge) {
          console.log(`\n[paw] Message from orchestrator:\n${nudge}\n`);
          clearNudge(mainRoot, taskName);
        }

        const cursor = readInboxCursor(mainRoot, taskName);
        const entries = readJournalForTask(taskName, cwd, cursor ?? undefined);

        // Exclude own messages so the agent only sees others' broadcasts
        const relevant = entries.filter((e) => e.from !== taskName);

        if (relevant.length > 0) {
          console.log(`\n[paw] ${relevant.length} new message(s) from other agents:`);
          for (const entry of relevant) {
            console.log(`  ${formatJournalEntry(entry)}`);
          }
          console.log();
        }

        const allEntries = readJournal(cwd);
        const { open } = computeThreads(allEntries);
        const unanswered = open.filter((t) => t.send.to === taskName);
        if (unanswered.length > 0) {
          console.log(`[paw] ${unanswered.length} unanswered message(s):`);
          for (const { send } of unanswered) {
            const id = send.thread.slice(0, 4);
            console.log(`  (${id}) ${send.from} → ${send.to}: "${send.msg}"`);
          }
          console.log(`  Reply with: paw reply "your answer"\n`);
        }

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

    if (broadcasts.length > 0) {
      console.log(pc.bold('Broadcasts'));
      for (const b of broadcasts) {
        console.log(`  ${pc.dim(b.from + ' →')} ${b.msg}`);
      }
    }

    if (open.length > 0) {
      if (broadcasts.length > 0) console.log('');
      console.log(pc.bold('Open threads') + pc.dim(' (reply needed)'));
      for (const { send } of open) {
        const id = send.thread.slice(0, 4);
        console.log(`  ${pc.dim(`(${id})`)} ${send.from} → ${send.to}  "${send.msg}"`);
      }
    }

    if (broadcasts.length === 0 && open.length === 0) {
      console.log('No broadcasts or open threads.');
    }
    if (resolved.length > 0) {
      if (hasContent) console.log('');
      console.log(pc.bold('Resolved threads'));
      for (const { send, reply } of resolved) {
        const id = send.thread.slice(0, 4);
        console.log(`  ${pc.dim(`(${id})`)} ${send.from} → ${send.to}  "${send.msg}"`);
        console.log(`       └─ ${reply.from}: "${reply.msg}"`);
      }
    }
  } catch (err) {
    handleError(err);
  }
}
