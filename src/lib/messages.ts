import { readSyncFile, writeSyncFile, listSyncDir } from './sync.js';

/** A single inter-agent message stored in the JSONL inbox on the sync branch. */
export interface Message {
  ts: string;
  from: string;
  type: 'broadcast' | 'send' | 'reply' | 'nudge';
  to?: string;
  msg: string;
  thread?: string;
}

/** Generate a 4-char random lowercase alphanumeric thread ID. */
export function generateThreadId(): string {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

/** Fields required when appending (ts and from are auto-populated). */
type MessageAppendOpts = Omit<Message, 'ts' | 'from'>;

/**
 * Append a message to the agent's own JSONL file on the sync branch.
 * Each agent only writes to inbox/{taskName}.jsonl -- zero write conflicts.
 */
export function appendMessage(taskName: string, opts: MessageAppendOpts, cwd?: string): Message {
  const entry: Message = {
    ts: new Date().toISOString(),
    from: taskName,
    ...opts,
  };

  const path = `inbox/${taskName}.jsonl`;
  const existing = readSyncFile(path, cwd) ?? '';
  const line = JSON.stringify(entry);
  const content = existing ? existing + '\n' + line : line;

  writeSyncFile(path, content, cwd);
  return entry;
}

/**
 * Read all inbox entries across all agents, sorted chronologically.
 */
export function readMessages(cwd?: string): Message[] {
  const files = listSyncDir('inbox', cwd);
  const entries: Message[] = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const content = readSyncFile(file, cwd);
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as Message);
      } catch {
        // Skip malformed lines
      }
    }
  }

  entries.sort((a, b) => a.ts.localeCompare(b.ts) || a.from.localeCompare(b.from));
  return entries;
}

/**
 * Find unanswered sends from `fromTask` directed at `taskName`.
 * A send is unanswered if no reply from `taskName` shares its thread ID.
 */
export function getUnansweredMessages(taskName: string, fromTask: string, cwd?: string): Message[] {
  const all = readMessages(cwd);

  const repliedThreads = new Set(
    all.filter((e) => e.type === 'reply' && e.from === taskName && e.thread).map((e) => e.thread!),
  );

  return all.filter(
    (e) =>
      e.type === 'send' &&
      e.from === fromTask &&
      e.to === taskName &&
      (!e.thread || !repliedThreads.has(e.thread)),
  );
}

/**
 * Reply to the oldest unanswered send from `toTask` directed at `taskName`.
 * Returns the reply Message, or null if no unanswered messages exist.
 */
export function replyToMessage(
  taskName: string,
  toTask: string,
  message: string,
  cwd?: string,
): Message | null {
  const unanswered = getUnansweredMessages(taskName, toTask, cwd);
  if (unanswered.length === 0) return null;

  const target = unanswered[0]!;
  return appendMessage(
    taskName,
    {
      type: 'reply',
      to: toTask,
      msg: message,
      ...(target.thread ? { thread: target.thread } : {}),
    },
    cwd,
  );
}

/** Returns messages addressed to or from taskName, optionally filtered to those after a timestamp cursor. */
export function readMessagesForTask(taskName: string, cwd?: string, since?: string): Message[] {
  const all = readMessages(cwd);

  return all.filter((entry) => {
    if (since && entry.ts <= since) return false;
    return entry.type === 'broadcast' || entry.to === taskName;
  });
}

/** Build the display prefix for a message (e.g. "[from] broadcast:" or "[from -> to]"). */
export function formatMessagePrefix(entry: Message): string {
  if (entry.type === 'nudge') return '[fleet]';
  if (entry.type === 'broadcast') return `[${entry.from}] broadcast:`;
  if (entry.to) return `[${entry.from} → ${entry.to}]`;
  return `[${entry.from}]`;
}

/** A message with a thread identifier — guaranteed to have `thread` set. */
export interface ThreadedMessage extends Message {
  thread: string;
}

/** An open (unanswered) message thread. */
export interface OpenThread {
  send: ThreadedMessage;
}

/** A resolved (answered) message thread. */
export interface ResolvedThread {
  send: ThreadedMessage;
  reply: ThreadedMessage;
}

function isThreaded(e: Message): e is ThreadedMessage {
  return typeof e.thread === 'string';
}

/** Match sends to replies by thread ID. Returns open and resolved thread pairs. */
export function matchThreads(entries: Message[]): {
  open: OpenThread[];
  resolved: ResolvedThread[];
} {
  const sends = entries.filter((e): e is ThreadedMessage => e.type === 'send' && isThreaded(e));
  const replyByThread = new Map<string, ThreadedMessage>();
  for (const e of entries) {
    if (e.type === 'reply' && isThreaded(e)) {
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

  return { open, resolved };
}

/** Returns open message threads addressed to taskName that have no reply. */
export function getUnansweredThreadsForTask(taskName: string, cwd: string): OpenThread[] {
  const allEntries = readMessages(cwd);
  const { open } = matchThreads(allEntries);
  return open.filter(({ send }) => send.to === taskName);
}
