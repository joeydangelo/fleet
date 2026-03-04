import { readSyncFile, writeSyncFile, listSyncDir } from './sync.js';

/** A single inter-agent message stored in the JSONL inbox on the sync branch. */
export interface Message {
  ts: string;
  from: string;
  type: 'broadcast' | 'send' | 'reply';
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
 * Read inbox entries relevant to a specific task:
 * - All broadcasts
 * - Messages directed at this task (to === taskName)
 *
 * Optionally filter to entries after a given timestamp.
 */
export function readMessagesForTask(taskName: string, cwd?: string, since?: string): Message[] {
  const all = readMessages(cwd);

  return all.filter((entry) => {
    if (since && entry.ts <= since) return false;
    return entry.type === 'broadcast' || entry.to === taskName;
  });
}
