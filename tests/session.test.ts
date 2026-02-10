import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import type { PawConfig } from "../src/lib/config.js";
import {
  planWorktrees,
  generateTaskFile,
  writeTaskFiles,
  ensureGitignore,
  detectTaskName,
} from "../src/lib/session.js";

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `paw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

const baseConfig: PawConfig = {
  base: "main",
  target: "feature/dashboard",
  tasks: {
    auth: { focus: "src/auth/" },
    api: { focus: ["src/api/", "src/routes/"] },
  },
};

describe("planWorktrees", () => {
  it("computes sibling worktree paths from repo root", () => {
    const result = planWorktrees(baseConfig, "/projects/acme-app");

    expect(result).toHaveLength(2);
    expect(result[0]?.worktreePath).toBe(
      resolve("/projects", "acme-app-paw-auth"),
    );
    expect(result[1]?.worktreePath).toBe(
      resolve("/projects", "acme-app-paw-api"),
    );
  });

  it("computes branch names as target/taskName", () => {
    const result = planWorktrees(baseConfig, "/projects/acme-app");

    expect(result[0]?.branch).toBe("feature/dashboard-auth");
    expect(result[1]?.branch).toBe("feature/dashboard-api");
  });

  it("preserves task names", () => {
    const result = planWorktrees(baseConfig, "/projects/acme-app");

    expect(result.map((w) => w.taskName)).toEqual(["auth", "api"]);
  });
});

describe("generateTaskFile", () => {
  it("produces expected markdown with single-string focus", () => {
    const worktree = {
      taskName: "auth",
      branch: "feature/dashboard-auth",
      worktreePath: "/projects/acme-app-paw-auth",
    };

    const result = generateTaskFile(baseConfig, "auth", worktree);

    expect(result).toContain("# Task: auth");
    expect(result).toContain("**Branch:** feature/dashboard-auth");
    expect(result).toContain("**Target:** feature/dashboard");
    expect(result).toContain("**Worktree:** /projects/acme-app-paw-auth");
    expect(result).toContain("- src/auth/");
  });

  it("handles array focus", () => {
    const worktree = {
      taskName: "api",
      branch: "feature/dashboard-api",
      worktreePath: "/projects/acme-app-paw-api",
    };

    const result = generateTaskFile(baseConfig, "api", worktree);

    expect(result).toContain("- src/api/");
    expect(result).toContain("- src/routes/");
  });

  it("includes instructions section when prompt is set", () => {
    const config: PawConfig = {
      ...baseConfig,
      tasks: {
        auth: { focus: "src/auth/", prompt: "Implement OAuth2 login." },
      },
    };
    const worktree = {
      taskName: "auth",
      branch: "feature/dashboard-auth",
      worktreePath: "/projects/acme-app-paw-auth",
    };

    const result = generateTaskFile(config, "auth", worktree);

    expect(result).toContain("## Instructions");
    expect(result).toContain("Implement OAuth2 login.");
  });

  it("omits instructions section when no prompt", () => {
    const worktree = {
      taskName: "auth",
      branch: "feature/dashboard-auth",
      worktreePath: "/projects/acme-app-paw-auth",
    };

    const result = generateTaskFile(baseConfig, "auth", worktree);

    expect(result).not.toContain("## Instructions");
  });

  it("throws on unknown task name", () => {
    const worktree = {
      taskName: "nope",
      branch: "feature/dashboard-nope",
      worktreePath: "/projects/acme-app-paw-nope",
    };

    expect(() => generateTaskFile(baseConfig, "nope", worktree)).toThrow(
      "Task not found: nope",
    );
  });
});

describe("writeTaskFiles", () => {
  it("creates .paw/tasks/<name>.md in each worktree dir", () => {
    const dir = makeTempDir();
    const wt1 = resolve(dir, "wt-auth");
    const wt2 = resolve(dir, "wt-api");
    mkdirSync(wt1, { recursive: true });
    mkdirSync(wt2, { recursive: true });

    const worktrees = [
      { taskName: "auth", branch: "feature/dashboard-auth", worktreePath: wt1 },
      { taskName: "api", branch: "feature/dashboard-api", worktreePath: wt2 },
    ];

    writeTaskFiles(baseConfig, worktrees);

    const authFile = resolve(wt1, ".paw", "tasks", "auth.md");
    const apiFile = resolve(wt2, ".paw", "tasks", "api.md");

    expect(existsSync(authFile)).toBe(true);
    expect(existsSync(apiFile)).toBe(true);

    const authContent = readFileSync(authFile, "utf-8");
    expect(authContent).toContain("# Task: auth");

    const apiContent = readFileSync(apiFile, "utf-8");
    expect(apiContent).toContain("# Task: api");
    expect(apiContent).toContain("- src/api/");
    expect(apiContent).toContain("- src/routes/");

    rmSync(dir, { recursive: true });
  });

  it("adds .paw/ to .gitignore in each worktree", () => {
    const dir = makeTempDir();
    const wt = resolve(dir, "wt-auth");
    mkdirSync(wt, { recursive: true });

    const worktrees = [
      { taskName: "auth", branch: "feature/dashboard-auth", worktreePath: wt },
    ];

    writeTaskFiles(baseConfig, worktrees);

    const gitignore = readFileSync(resolve(wt, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".paw/");

    rmSync(dir, { recursive: true });
  });
});

describe("detectTaskName", () => {
  it("finds task name from single file in .paw/tasks/", () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, ".paw", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, "auth.md"), "# Task: auth\n");

    expect(detectTaskName(dir)).toBe("auth");

    rmSync(dir, { recursive: true });
  });

  it("returns null when .paw/tasks/ does not exist", () => {
    const dir = makeTempDir();

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });

  it("returns null when .paw/tasks/ has multiple files", () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, ".paw", "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(resolve(tasksDir, "auth.md"), "# auth\n");
    writeFileSync(resolve(tasksDir, "api.md"), "# api\n");

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });

  it("returns null when .paw/tasks/ is empty", () => {
    const dir = makeTempDir();
    const tasksDir = resolve(dir, ".paw", "tasks");
    mkdirSync(tasksDir, { recursive: true });

    expect(detectTaskName(dir)).toBeNull();

    rmSync(dir, { recursive: true });
  });
});

describe("ensureGitignore", () => {
  it("creates .gitignore with .paw/ when none exists", () => {
    const dir = makeTempDir();

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, ".gitignore"), "utf-8");
    expect(content).toBe(".paw/\n");

    rmSync(dir, { recursive: true });
  });

  it("appends .paw/ to existing .gitignore", () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, ".gitignore"), "node_modules/\ndist/\n");

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".paw/");
  });

  it("does not duplicate .paw/ if already present", () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, ".gitignore"), "node_modules/\n.paw/\n");

    ensureGitignore(dir);

    const content = readFileSync(resolve(dir, ".gitignore"), "utf-8");
    const matches = content.match(/\.paw\//g);
    expect(matches).toHaveLength(1);

    rmSync(dir, { recursive: true });
  });
});
