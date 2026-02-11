import { Command } from "commander";
import pc from "picocolors";
import { getRepoRoot } from "../lib/git.js";
import { detectTaskName } from "../lib/session.js";
import {
  readSyncState,
  completeTask,
  writeSyncStateAndFiles,
} from "../lib/sync.js";
import { handleError } from "../lib/output.js";
import { validateSummary } from "../lib/summary.js";

const SUMMARY_TEMPLATE = `## What I did
- [Major accomplishment 1]
- [Major accomplishment 2]

## Interface changes
- [Type/export/API changes other agents need to know about]
- [New exports, renamed functions, changed signatures]

## Watch out
- [Non-obvious things: env vars, ordering dependencies, breaking changes]
- [Anything that isn't clear from the diff alone]`;

export function doneCommand(): Command {
  return new Command("done")
    .description("Mark current task as completed")
    .option(
      "--summary <text>",
      "Completion summary (what you did, interface changes, warnings)",
    )
    .option("--force", "Bypass summary validation")
    .action((opts: { summary?: string; force?: boolean }) => {
      try {
        const repoRoot = getRepoRoot();
        const taskName = detectTaskName(repoRoot);

        if (!taskName) {
          console.error(
            pc.red("Could not detect task name. Are you in a paw worktree?"),
          );
          console.error(
            pc.dim(
              "Expected a single .md file in .paw/tasks/. Run `paw up` to create worktrees.",
            ),
          );
          process.exit(1);
        }

        const state = readSyncState(repoRoot);
        if (!state) {
          console.error(pc.red("No sync state found. Run `paw up` first."));
          process.exit(1);
        }

        if (!state.tasks[taskName]) {
          console.error(pc.red(`Task '${taskName}' not found in sync state.`));
          process.exit(1);
        }

        if (!opts.summary) {
          console.error(
            pc.red("Missing --summary flag. A structured summary is required."),
          );
          console.error("");
          console.error(pc.bold("Expected format:"));
          console.error(pc.dim(SUMMARY_TEMPLATE));
          console.error("");
          console.error(
            pc.dim("Run `paw template task-summary` for full details."),
          );
          process.exit(1);
        }

        const validation = validateSummary(opts.summary);
        if (!validation.valid && !opts.force) {
          console.error(
            pc.yellow(
              `Summary is missing required sections: ${validation.missing.join(", ")}`,
            ),
          );
          console.error("");
          console.error(pc.bold("Expected format:"));
          console.error(pc.dim(SUMMARY_TEMPLATE));
          console.error("");
          console.error(
            pc.dim(
              "Run `paw template task-summary` for full details, or use --force to bypass.",
            ),
          );
          process.exit(1);
        }

        const updated = completeTask(state, taskName);
        const summaryPath = `summaries/${taskName}.md`;
        writeSyncStateAndFiles(
          updated,
          [{ path: summaryPath, content: opts.summary }],
          repoRoot,
        );
        console.log(pc.green(`+ ${taskName} -- marked as completed`));
        console.log(
          pc.dim(`  Summary written to ${summaryPath} on sync branch`),
        );
      } catch (err) {
        handleError(err);
      }
    });
}
