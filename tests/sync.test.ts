import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  initSyncState,
  claimTask,
  completeTask,
  writeSyncState,
  readSyncState,
  writeSyncFile,
  readSyncFile,
  writeSyncStateAndFiles,
  listSyncDir,
} from "../src/lib/sync.js";
import { deleteBranch } from "../src/lib/git.js";
import type { SyncState } from "../src/lib/sync.js";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("initSyncState", () => {
  it("creates state with all tasks pending", () => {
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");

    expect(state.target).toBe("feature/dash");
    expect(state.config).toBe("paw.yaml");
    expect(Object.keys(state.tasks)).toEqual(["auth", "api"]);
    expect(state.tasks["auth"]?.status).toBe("pending");
    expect(state.tasks["api"]?.status).toBe("pending");
    expect(state.session).toBeTruthy();
  });
});

describe("claimTask", () => {
  it("sets status to in_progress with timestamp", () => {
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    const claimed = claimTask(state, "auth");

    expect(claimed.tasks["auth"]?.status).toBe("in_progress");
    expect(claimed.tasks["auth"]?.claimed).toBeTruthy();
    expect(claimed.tasks["api"]?.status).toBe("pending");
  });

  it("throws on unknown task", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");

    expect(() => claimTask(state, "nope")).toThrow(
      "Task not found in sync state: nope",
    );
  });
});

describe("completeTask", () => {
  it("sets status to completed with timestamp", () => {
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    const completed = completeTask(state, "auth");

    expect(completed.tasks["auth"]?.status).toBe("completed");
    expect(completed.tasks["auth"]?.completed).toBeTruthy();
    expect(completed.tasks["api"]?.status).toBe("pending");
  });

  it("throws on unknown task", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");

    expect(() => completeTask(state, "nope")).toThrow(
      "Task not found in sync state: nope",
    );
  });
});

describe("writeSyncState / readSyncState", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns null when no sync branch exists", () => {
    expect(readSyncState(repoDir)).toBeNull();
  });

  it("round-trips sync state through git", () => {
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    writeSyncState(state, repoDir);

    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.target).toBe("feature/dash");
    expect(read!.config).toBe("paw.yaml");
    expect(Object.keys(read!.tasks)).toEqual(["auth", "api"]);
    expect(read!.tasks["auth"]?.status).toBe("pending");
  });

  it("overwrites previous state on second write", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");
    writeSyncState(state, repoDir);

    const updated = claimTask(state, "auth");
    writeSyncState(updated, repoDir);

    const read = readSyncState(repoDir);
    expect(read!.tasks["auth"]?.status).toBe("in_progress");
  });
});

describe("writeSyncFile / readSyncFile", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    // Need sync branch to exist first
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");
    writeSyncState(state, repoDir);

    expect(readSyncFile("nonexistent.md", repoDir)).toBeNull();
  });

  it("round-trips a file through the sync branch", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");
    writeSyncState(state, repoDir);

    const content = "# Summary\n\nDid some work.";
    writeSyncFile("summaries/auth.md", content, repoDir);

    // git show trims trailing newlines, so compare trimmed
    const read = readSyncFile("summaries/auth.md", repoDir);
    expect(read).toBe(content);
  });

  it("preserves existing files when writing new ones", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");
    writeSyncState(state, repoDir);

    writeSyncFile("summaries/auth.md", "auth summary", repoDir);
    writeSyncFile("summaries/api.md", "api summary", repoDir);

    // Both files should exist
    expect(readSyncFile("summaries/auth.md", repoDir)).toBe("auth summary");
    expect(readSyncFile("summaries/api.md", repoDir)).toBe("api summary");

    // State should also still be readable
    const readState = readSyncState(repoDir);
    expect(readState).not.toBeNull();
  });
});

describe("writeSyncStateAndFiles", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("writes state and files atomically", () => {
    const state = initSyncState("feature/dash", ["auth"], "paw.yaml");
    const completed = completeTask(state, "auth");

    writeSyncStateAndFiles(
      completed,
      [{ path: "summaries/auth.md", content: "auth done" }],
      repoDir,
    );

    const readState = readSyncState(repoDir);
    expect(readState?.tasks["auth"]?.status).toBe("completed");

    const summary = readSyncFile("summaries/auth.md", repoDir);
    expect(summary).toBe("auth done");
  });
});

describe("listSyncDir", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns empty array when no sync branch", () => {
    expect(listSyncDir("summaries", repoDir)).toEqual([]);
  });

  it("lists files under a prefix", () => {
    const state = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    writeSyncState(state, repoDir);

    writeSyncFile("summaries/auth.md", "auth summary", repoDir);
    writeSyncFile("summaries/api.md", "api summary", repoDir);

    const files = listSyncDir("summaries", repoDir);
    expect(files).toContain("summaries/auth.md");
    expect(files).toContain("summaries/api.md");
    expect(files).toHaveLength(2);
  });
});

describe("session leak (paw-pm8q)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTempDir();
    gitInit(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("does not carry journal entries across delete + re-init", () => {
    // Session 1: create state and write journal entries
    const state1 = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    writeSyncStateAndFiles(
      state1,
      [
        { path: "journal/.gitkeep", content: "" },
        { path: "journal/auth.jsonl", content: '{"msg":"old entry"}' },
      ],
      repoDir,
    );

    expect(readSyncFile("journal/auth.jsonl", repoDir)).toBe(
      '{"msg":"old entry"}',
    );

    // Simulate paw down: delete the sync branch
    deleteBranch("paw-sync", repoDir);

    // Session 2: re-init with fresh state
    const state2 = initSyncState("feature/dash", ["auth", "api"], "paw.yaml");
    writeSyncStateAndFiles(
      state2,
      [{ path: "journal/.gitkeep", content: "" }],
      repoDir,
    );

    // Old journal entry must NOT be present
    expect(readSyncFile("journal/auth.jsonl", repoDir)).toBeNull();
    expect(listSyncDir("journal", repoDir)).toEqual(["journal/.gitkeep"]);

    // Fresh state should be readable
    const read = readSyncState(repoDir);
    expect(read).not.toBeNull();
    expect(read!.tasks["auth"]?.status).toBe("pending");
  });
});
