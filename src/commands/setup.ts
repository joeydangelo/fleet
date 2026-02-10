import { Command } from "commander";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { getDocsBasePath } from "../lib/docs.js";
import { success, skip, handleError } from "../lib/output.js";

const SKILL_CONTENT = `---
description: paw -- Parallel Agent Worktrees. Orchestrates multiple AI agents across git worktrees with coordination via broadcasts, summaries, and conflict briefs. Use when the user mentions paw, parallel agents, worktrees, or multi-agent coordination.
globs: "paw.yaml,paw.yml,.paw/**"
---

# paw

paw orchestrates parallel AI coding agents across git worktrees. Agents work in
isolated worktrees, communicate through a shared sync branch, and merge results
back with full context about what each agent intended.

You are one of those agents. paw gives you your task assignment, keeps you informed
about what other agents are doing, and helps the team merge without surprises.

## On Session Start

Run \`paw prime\` immediately. It gives you everything in one shot:
- Your task assignment (focus areas, instructions)
- Team status (who's working, who's done)
- Recent broadcasts from other agents
- Messages directed at you
- Completed summaries from finished agents

For the full session-start workflow, run \`paw shortcut session-start\`.

## Commands

\`\`\`
paw prime              # orient + self-assign (run this first)
paw status             # check progress across all tasks
paw broadcast "..."    # announce a change to all agents
paw ask <task> "..."   # send a directed message to a specific agent
paw reply "..."        # reply to the most recent directed message
paw check              # read new messages and broadcasts
paw done --summary "." # mark task completed with summary
\`\`\`

## Workflow

1. \`paw prime\` -- read your assignment, see the team state
2. Broadcast your intent before starting work
3. Work on your task, staying within your focus areas
4. \`paw broadcast "..."\` when you change interfaces other agents depend on
5. \`paw check\` periodically for messages from other agents
6. Follow \`paw shortcut precommit-process\` when committing
7. \`paw shortcut session-end\` when finished

## Shortcuts

Run \`paw shortcut <name>\` for step-by-step workflows:

| Shortcut | Purpose |
|---|---|
| \`generate-paw-yaml\` | Analyze a codebase and create a paw.yaml |
| \`session-start\` | Agent's first actions in a worktree |
| \`session-end\` | Wrap up: broadcast final state, write done summary |
| \`resolve-conflict\` | Read conflict brief, resolve, merge --continue |
| \`precommit-process\` | Review, test, broadcast, and commit checklist |

## Guidelines

Run \`paw guidelines <name>\` for reference knowledge:

| Guideline | Purpose |
|---|---|
| \`commit-conventions\` | Conventional Commits format for multi-agent work |
| \`paw-task-decomposition\` | How to split work into good parallel tasks |

## Templates

Run \`paw template <name>\` for document structures:

| Template | Purpose |
|---|---|
| \`paw-yaml\` | Annotated paw.yaml config structure |
| \`task-summary\` | Done summary structure (what/interfaces/watch-out) |

## Key Principles

- **Broadcast interface changes.** If you change a type, export, or API that another
  task might depend on, broadcast it. This is the most important coordination action.
- **Stay in your focus area.** Your task file lists which files you own. Editing files
  outside your focus area causes merge conflicts.
- **Read before you plan.** \`paw prime\` shows what other agents have done and said.
  Adapt your approach to the current state, not your initial assumptions.
- **Write a good summary.** Your done summary is what the merge process and resolver
  agents use to understand your work. See \`paw template task-summary\`.
`;

export function setupCommand(): Command {
  return new Command("setup")
    .description("Initialize paw in a repo")
    .action(() => {
      try {
        const repoRoot = getRepoRoot();

        console.log(pc.bold("paw setup\n"));

        // Write skill file
        const skillDir = resolve(repoRoot, ".claude", "skills", "paw");
        const skillPath = resolve(skillDir, "SKILL.md");
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillPath, SKILL_CONTENT, "utf-8");
        success("skill", skillPath);

        // Ensure .paw/ is in .gitignore
        const gitignorePath = resolve(repoRoot, ".gitignore");
        let gitignore = "";
        if (existsSync(gitignorePath)) {
          gitignore = readFileSync(gitignorePath, "utf-8");
        }

        if (gitignore.includes(".paw/")) {
          skip("gitignore", ".paw/ already present");
        } else {
          const separator =
            gitignore.length > 0 && !gitignore.endsWith("\n") ? "\n" : "";
          writeFileSync(
            gitignorePath,
            gitignore + separator + "\n# paw working state\n.paw/\n",
            "utf-8",
          );
          success("gitignore", "added .paw/");
        }

        // Copy bundled docs to .paw/docs/
        try {
          const docsBase = getDocsBasePath();
          const destDocs = resolve(repoRoot, ".paw", "docs");
          cpSync(docsBase, destDocs, { recursive: true });
          success("docs", destDocs);
        } catch {
          // Docs may not be available in dev without a build
          skip("docs", "bundled docs not found (run pnpm build)");
        }

        // Install Claude Code hooks
        const settingsPath = resolve(repoRoot, ".claude", "settings.json");
        installHooks(settingsPath);

        console.log(
          pc.dim("\nCreate a paw.yaml and run `paw up` to start a session."),
        );
      } catch (err) {
        handleError(err);
      }
    });
}

function installHooks(settingsPath: string): void {
  const pawHooks = {
    SessionStart: [{ command: "paw prime --brief" }],
    PreCompact: [{ command: "paw prime --brief" }],
  };

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      // Corrupted settings -- overwrite
    }
  }

  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  let changed = false;

  for (const [event, hooks] of Object.entries(pawHooks)) {
    const current = existing[event] ?? [];
    const hasPaw = current.some(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        "command" in h &&
        typeof (h as { command: string }).command === "string" &&
        (h as { command: string }).command.startsWith("paw "),
    );
    if (!hasPaw) {
      existing[event] = [...current, ...hooks];
      changed = true;
    }
  }

  if (changed) {
    settings.hooks = existing;
    mkdirSync(resolve(settingsPath, ".."), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    success("hooks", "SessionStart + PreCompact → paw prime --brief");
  } else {
    skip("hooks", "paw hooks already installed");
  }
}
