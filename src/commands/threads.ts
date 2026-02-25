import { Command } from 'commander';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { readJournal } from '../lib/journal.js';
import type { JournalEntry } from '../lib/journal.js';
import { handleError } from '../lib/output.js';

/** Journal entry that carries a thread identifier. */
type ThreadedEntry = JournalEntry & { thread: string };

function hasThread(e: JournalEntry): e is ThreadedEntry {
  return typeof (e as unknown as { thread?: unknown }).thread === 'string';
}

interface OpenThread {
  ask: ThreadedEntry;
}

interface ResolvedThread {
  ask: ThreadedEntry;
  reply: ThreadedEntry;
}

interface ThreadResult {
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

export function threadsCommand(): Command {
  return new Command('threads')
    .description('Show broadcasts, open threads, and resolved threads')
    .option('-a, --all', 'Show all threads (open and resolved)')
    .action((opts: { all?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const entries = readJournal(repoRoot);
        const { open, resolved, broadcasts } = computeThreads(entries);

        const hasContent = broadcasts.length > 0 || open.length > 0;

        if (!hasContent && !opts.all) {
          console.log('No broadcasts or open threads.');
          return;
        }

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

        if (opts.all) {
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
        }
      } catch (err) {
        handleError(err);
      }
    });
}
