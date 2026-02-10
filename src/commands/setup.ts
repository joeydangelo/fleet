import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { success, skip, handleError } from "../lib/output.js";

const SKILL_CONTENT = `---
description: paw -- Parallel Agent Worktrees
globs: "paw.yaml,paw.yml,.paw/**"
---

# paw

paw orchestrates parallel AI coding agents across git worktrees.

## On Session Start

If you are in a paw worktree, run \`paw prime\` to:
- Read your task assignment
- Claim the task so other agents see you're working on it
- See what other agents are doing
- Read recent broadcasts and directed messages from other agents

## Commands

\`\`\`
paw prime              # orient + self-assign (run this first)
paw status             # check progress across all tasks
paw broadcast "..."    # announce a change to all agents
paw ask <task> "..."   # send a directed message to a specific agent
paw reply "..."        # reply to the most recent directed message
paw check              # read new messages and broadcasts
paw done               # mark your task as completed (use --summary)
\`\`\`

## Workflow

1. Read your task file at \`.paw/tasks/<name>.md\`
2. Work on the task, committing to your branch as you go
3. Run \`paw broadcast "..."\` when you make significant changes
4. Run \`paw check\` periodically to read messages from other agents
5. Run \`paw done --summary "..."\` when finished
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

        console.log(
          pc.dim("\nCreate a paw.yaml and run `paw up` to start a session."),
        );
      } catch (err) {
        handleError(err);
      }
    });
}
