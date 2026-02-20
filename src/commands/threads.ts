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
}

/**
 * Compute open and resolved threads from journal entries.
 * Open: ask entries with a thread value that have no matching reply.
 * Resolved: ask entries with a matching reply (same thread value).
 * Entries without a thread field are skipped.
 */
export function computeThreads(entries: JournalEntry[]): ThreadResult {
  const asks = entries.filter((e): e is ThreadedEntry => e.type === 'ask' && hasThread(e));
  const replyByThread = new Map<string, ThreadedEntry>();

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

  return { open, resolved };
}

export function threadsCommand(): Command {
  return new Command('threads')
    .description('Show open and resolved ask/reply threads')
    .option('-a, --all', 'Show all threads (open and resolved)')
    .action((opts: { all?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const entries = readJournal(repoRoot);
        const { open, resolved } = computeThreads(entries);

        if (open.length === 0 && !opts.all) {
          console.log('No open threads.');
          return;
        }

        for (const { ask } of open) {
          const id = ask.thread.slice(0, 4);
          console.log(`${pc.dim(`(${id})`)}  ${ask.from} → ${ask.to}   "${ask.msg}"`);
        }

        if (opts.all) {
          if (open.length === 0) {
            console.log('No open threads.');
          }
          if (resolved.length > 0) {
            if (open.length > 0) console.log('');
            for (const { ask, reply } of resolved) {
              const id = ask.thread.slice(0, 4);
              console.log(`${pc.dim(`(${id})`)}  ${ask.from} → ${ask.to}   "${ask.msg}"`);
              console.log(`       └─ ${reply.from}: "${reply.msg}"`);
            }
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}
