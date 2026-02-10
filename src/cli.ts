import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { upCommand } from "./commands/up.js";
import { primeCommand } from "./commands/prime.js";
import { statusCommand } from "./commands/status.js";
import { doneCommand } from "./commands/done.js";
import { mergeCommand } from "./commands/merge.js";
import { downCommand } from "./commands/down.js";
import { completionsCommand } from "./commands/completions.js";
import { broadcastCommand } from "./commands/broadcast.js";
import { askCommand } from "./commands/ask.js";
import { replyCommand } from "./commands/reply.js";
import { checkCommand } from "./commands/check.js";
import { shortcutCommand } from "./commands/shortcut.js";
import { guidelinesCommand } from "./commands/guidelines.js";
import { templateCommand } from "./commands/template.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("paw")
    .description(
      "Parallel Agent Worktrees -- orchestrate multi-agent git worktree workflows",
    )
    .version("0.1.0");

  program.addCommand(setupCommand());
  program.addCommand(upCommand());
  program.addCommand(primeCommand());
  program.addCommand(statusCommand());
  program.addCommand(doneCommand());
  program.addCommand(mergeCommand());
  program.addCommand(downCommand());
  program.addCommand(broadcastCommand());
  program.addCommand(askCommand());
  program.addCommand(replyCommand());
  program.addCommand(checkCommand());
  program.addCommand(shortcutCommand());
  program.addCommand(guidelinesCommand());
  program.addCommand(templateCommand());
  program.addCommand(completionsCommand());

  return program;
}
