import { Command } from 'commander';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'atomically';
import { join } from 'node:path';
import { resolveMainRoot } from '../lib/git.js';
import { swallowENOENT } from '../lib/util.js';
import { detectTaskName } from '../lib/session.js';
import { readInboxCursor, writeInboxCursor } from '../lib/health.js';
import {
  readMessagesForTask,
  getUnansweredThreadsForTask,
  formatMessagePrefix,
  matchThreads,
} from '../lib/messages.js';
import type { Message, OpenThread, ResolvedThread } from '../lib/messages.js';
export type { OpenThread, ResolvedThread } from '../lib/messages.js';
import { INBOX_GATE_PREFIX } from '../lib/constants.js';

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
 * Broadcasts: entries with type === 'broadcast' or 'nudge'.
 */
export function computeThreads(entries: Message[]): ThreadResult {
  const { open, resolved } = matchThreads(entries);
  const broadcasts = entries.filter((e) => e.type === 'broadcast' || e.type === 'nudge');
  return { open, resolved, broadcasts };
}

/** Formats a Message entry as a display string; layout varies by type: nudge, broadcast, directed, or plain. */
export function formatMessageForCLI(entry: Message): string {
  const prefix = formatMessagePrefix(entry);
  if (entry.type === 'nudge') return `${prefix} Warning: ${entry.msg}`;
  return `${prefix} ${entry.msg}`;
}

/** Format unanswered threads into the gate denial message. */
export function formatGateContent(unanswered: OpenThread[]): string {
  const lines: string[] = [
    `You have ${unanswered.length} unanswered message(s). Reply before continuing.`,
    '',
  ];
  for (const { send } of unanswered) {
    const id = send.thread.slice(0, 4);
    lines.push(`  (${id}) ${send.from} → ${send.to}: "${send.msg}"`);
  }
  lines.push('');
  lines.push('Reply with: fleet reply <task> "your answer"');
  return lines.join('\n');
}

/** Write the inbox gate flag file for a task with unanswered messages. */
export function writeGateFlag(cwd: string, taskName: string, unanswered: OpenThread[]): void {
  const flagPath = join(cwd, `${INBOX_GATE_PREFIX}${taskName}`);
  mkdirSync(join(cwd, '.fleet', 'run'), { recursive: true });
  writeFileSync(flagPath, formatGateContent(unanswered));
}

/** Clear the inbox gate flag file for a task. Swallows ENOENT. */
export function clearGateFlag(cwd: string, taskName: string): void {
  swallowENOENT(() => rmSync(join(cwd, `${INBOX_GATE_PREFIX}${taskName}`)));
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

        const cursor = readInboxCursor(mainRoot, taskName);
        const entries = readMessagesForTask(taskName, cwd, cursor ?? undefined);

        // Exclude own messages so the agent only sees others' broadcasts
        const relevant = entries.filter((e) => e.from !== taskName);

        if (relevant.length > 0) {
          console.log(`\n[fleet] ${relevant.length} new message(s) from other agents:`);
          for (const entry of relevant) {
            console.log(`  ${formatMessageForCLI(entry)}`);
          }
          console.log();
        }

        const unanswered = getUnansweredThreadsForTask(taskName, cwd);
        if (unanswered.length > 0) {
          console.log(`[fleet] ${unanswered.length} unanswered message(s):`);
          for (const { send } of unanswered) {
            const id = send.thread.slice(0, 4);
            console.log(`  (${id}) ${send.from} → ${send.to}: "${send.msg}"`);
          }
          console.log(`  Reply with: fleet reply <task> "your answer"\n`);
          writeGateFlag(cwd, taskName, unanswered);
        } else {
          clearGateFlag(cwd, taskName);
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
