import { readSyncFile, writeSyncFile, listSyncDir } from './sync.js';

export interface JournalEntry {
  ts: string;
  from: string;
  type: 'broadcast' | 'ask' | 'reply';
  to?: string;
  msg: string;
  thread?: string;
}

/** Generate a 4-char random lowercase alphanumeric thread ID. */
export function generateThreadId(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** Fields required when appending (ts and from are auto-populated). */
type JournalAppendOpts = Omit<JournalEntry, 'ts' | 'from'>;

/**
 * Append a journal entry to the agent's own JSONL file on the sync branch.
 * Each agent only writes to journal/{taskName}.jsonl -- zero write conflicts.
 */
export function appendJournalEntry(
  taskName: string,
  opts: JournalAppendOpts,
  cwd?: string,
): JournalEntry {
  const entry: JournalEntry = {
    ts: new Date().toISOString(),
    from: taskName,
    ...opts,
  };

  const path = `journal/${taskName}.jsonl`;
  const existing = readSyncFile(path, cwd) ?? '';
  const line = JSON.stringify(entry);
  const content = existing ? existing + '\n' + line : line;

  writeSyncFile(path, content, cwd);
  return entry;
}

/**
 * Read all journal entries across all agents, sorted chronologically.
 */
export function readJournal(cwd?: string): JournalEntry[] {
  const files = listSyncDir('journal', cwd);
  const entries: JournalEntry[] = [];

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const content = readSyncFile(file, cwd);
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as JournalEntry);
      } catch {
        // Skip malformed lines
      }
    }
  }

  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return entries;
}

/**
 * Read journal entries relevant to a specific task:
 * - All broadcasts
 * - Messages directed at this task (to === taskName)
 *
 * Optionally filter to entries after a given timestamp.
 */
export function readJournalForTask(taskName: string, cwd?: string, since?: string): JournalEntry[] {
  const all = readJournal(cwd);

  return all.filter((entry) => {
    if (since && entry.ts <= since) return false;
    return entry.type === 'broadcast' || entry.to === taskName;
  });
}
