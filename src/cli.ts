import { Command } from "commander";
import { upCommand } from "./commands/up.js";
import { statusCommand } from "./commands/status.js";
import { mergeCommand } from "./commands/merge.js";
import { downCommand } from "./commands/down.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("paw")
    .description(
      "Parallel Agent Worktrees — orchestrate multi-agent git worktree workflows",
    )
    .version("0.1.0");

  program.addCommand(upCommand());
  program.addCommand(statusCommand());
  program.addCommand(mergeCommand());
  program.addCommand(downCommand());

  return program;
}
