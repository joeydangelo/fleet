import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  initSyncState,
  writeSyncState,
  readSyncState,
} from "../src/lib/sync.js";
import {
  appendJournalEntry,
  readJournal,
  readJournalForTask,
} from "../src/lib/journal.js";
import type { JournalEntry } from "../src/lib/journal.js";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-journal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", dir], { stdio: "pipe" });
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: dir,
    stdio: "pipe",
  });
}

describe("appendJournalEntry / readJournal", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    // Need sync branch for journal operations
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("round-trips a broadcast entry", () => {
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Changed auth interface" },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe("auth");
    expect(entries[0]!.type).toBe("broadcast");
    expect(entries[0]!.msg).toBe("Changed auth interface");
    expect(entries[0]!.ts).toBeTruthy();
    expect(entries[0]!.to).toBeUndefined();
  });

  it("round-trips a directed ask entry", () => {
    appendJournalEntry(
      "api",
      { type: "ask", to: "auth", msg: "What token type?" },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.from).toBe("api");
    expect(entries[0]!.type).toBe("ask");
    expect(entries[0]!.to).toBe("auth");
    expect(entries[0]!.msg).toBe("What token type?");
  });

  it("round-trips a reply entry", () => {
    appendJournalEntry(
      "auth",
      { type: "reply", to: "api", msg: "Union type" },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("reply");
    expect(entries[0]!.to).toBe("api");
  });

  it("appends multiple entries to the same agent file", () => {
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "First change" },
      repoDir,
    );
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Second change" },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.msg).toBe("First change");
    expect(entries[1]!.msg).toBe("Second change");
  });

  it("merges entries from multiple agents chronologically", () => {
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Auth change" },
      repoDir,
    );
    appendJournalEntry(
      "api",
      { type: "broadcast", msg: "API change" },
      repoDir,
    );
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Auth update" },
      repoDir,
    );

    const entries = readJournal(repoDir);
    expect(entries).toHaveLength(3);
    // Should be sorted chronologically
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.ts >= entries[i - 1]!.ts).toBe(true);
    }
  });

  it("returns empty array when no journal entries exist", () => {
    const entries = readJournal(repoDir);
    expect(entries).toEqual([]);
  });
});

describe("readJournalForTask", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
    const state = initSyncState(
      "feature/dash",
      ["auth", "api", "dashboard"],
      "paw.yaml",
    );
    writeSyncState(state, repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns broadcasts and messages directed at the task", () => {
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Changed interface" },
      repoDir,
    );
    appendJournalEntry(
      "api",
      { type: "ask", to: "auth", msg: "What type?" },
      repoDir,
    );
    appendJournalEntry(
      "dashboard",
      { type: "ask", to: "api", msg: "Endpoint ready?" },
      repoDir,
    );

    // auth should see: the broadcast (it's own but all broadcasts are shown),
    // and the ask directed at it
    const forAuth = readJournalForTask("auth", repoDir);
    const directed = forAuth.filter((e) => e.to === "auth");
    expect(directed).toHaveLength(1);
    expect(directed[0]!.from).toBe("api");

    // api should see the message directed at it
    const forApi = readJournalForTask("api", repoDir);
    const directedToApi = forApi.filter((e) => e.to === "api");
    expect(directedToApi).toHaveLength(1);
    expect(directedToApi[0]!.from).toBe("dashboard");
  });

  it("filters by since timestamp", () => {
    appendJournalEntry(
      "auth",
      { type: "broadcast", msg: "Old message" },
      repoDir,
    );
    appendJournalEntry(
      "api",
      { type: "broadcast", msg: "New message" },
      repoDir,
    );

    const allEntries = readJournal(repoDir);
    expect(allEntries).toHaveLength(2);

    // Use a timestamp far in the past -- both entries should be included
    const ancient = "2020-01-01T00:00:00.000Z";
    const afterAncient = readJournalForTask("dashboard", repoDir, ancient);
    expect(afterAncient).toHaveLength(2);

    // Use a timestamp far in the future -- no entries should be included
    const future = "2099-01-01T00:00:00.000Z";
    const afterFuture = readJournalForTask("dashboard", repoDir, future);
    expect(afterFuture).toHaveLength(0);

    // Use the first entry's timestamp -- should exclude it
    const since = allEntries[0]!.ts;
    const afterFirst = readJournalForTask("dashboard", repoDir, since);
    // The old entry (at or before `since`) is excluded
    const msgs = afterFirst.map((e) => e.msg);
    expect(msgs).not.toContain("Old message");
  });
});
