import { Command } from 'commander';
import { resolveMainRoot } from '../lib/git.js';
import { detectTaskName } from '../lib/session.js';
import { readNudge, clearNudge, readInboxCursor, writeInboxCursor } from '../lib/health.js';
import { readMessages, readMessagesForTask } from '../lib/messages.js';
import type { Message } from '../lib/messages.js';

/** Message that carries a thread identifier. */
type ThreadedEntry = Message & { thread: string };

function hasThread(e: Message): e is ThreadedEntry {
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

/** Categorised inbox entries: open threads, resolved threads, and broadcasts. */
export interface ThreadResult {
  open: OpenThread[];
  resolved: ResolvedThread[];
  broadcasts: Message[];
}

/**
 * Compute open threads, resolved threads, and broadcasts from inbox entries.
 * Open: send entries with a thread value that have no matching reply.
 * Resolved: send entries with a matching reply (same thread value).
 * Broadcasts: entries with type === 'broadcast'.
 * Entries without a thread field (other than broadcasts) are skipped.
 */
export function computeThreads(entries: Message[]): ThreadResult {
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

function formatMessage(entry: Message): string {
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
    .action(() => {
      try {
        const cwd = process.cwd();
        const taskName = detectTaskName(cwd);

        if (!taskName) return;
        const mainRoot = resolveMainRoot(cwd);

        const nudge = readNudge(mainRoot, taskName);
        if (nudge) {
          console.log(`\n[paw] Message from orchestrator:\n${nudge}\n`);
          clearNudge(mainRoot, taskName);
        }

        const cursor = readInboxCursor(mainRoot, taskName);
        const entries = readMessagesForTask(taskName, cwd, cursor ?? undefined);

        // Exclude own messages so the agent only sees others' broadcasts
        const relevant = entries.filter((e) => e.from !== taskName);

        if (relevant.length > 0) {
          console.log(`\n[paw] ${relevant.length} new message(s) from other agents:`);
          for (const entry of relevant) {
            console.log(`  ${formatMessage(entry)}`);
          }
          console.log();
        }

        const allEntries = readMessages(cwd);
        const { open } = computeThreads(allEntries);
        const unanswered = open.filter((t) => t.send.to === taskName);
        if (unanswered.length > 0) {
          console.log(`[paw] ${unanswered.length} unanswered message(s):`);
          for (const { send } of unanswered) {
            const id = send.thread.slice(0, 4);
            console.log(`  (${id}) ${send.from} → ${send.to}: "${send.msg}"`);
          }
          console.log(`  Reply with: paw reply <task> "your answer"\n`);
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
