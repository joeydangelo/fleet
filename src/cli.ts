import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { setVerbosity } from './lib/context.js';
import { setupCommand } from './commands/setup.js';
import { upCommand } from './commands/up.js';
import { primeCommand } from './commands/prime.js';
import { statusCommand } from './commands/status.js';
import { doneCommand } from './commands/done.js';
import { mergeCommand } from './commands/merge.js';
import { downCommand } from './commands/down.js';
import { broadcastCommand } from './commands/broadcast.js';
import { askCommand } from './commands/ask.js';
import { replyCommand } from './commands/reply.js';
import { threadsCommand } from './commands/threads.js';
import { shortcutCommand } from './commands/shortcut.js';
import { guidelinesCommand } from './commands/guidelines.js';
import { templateCommand } from './commands/template.js';
import { launchCommand } from './commands/launch.js';
import { watchCommand } from './commands/watch.js';
import { goCommand } from './commands/go.js';

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
) as { version: string };

export function createCli(): Command {
  const program = new Command();

  program
    .name('paw')
    .description('Parallel Agent Worktrees -- orchestrate multi-agent git worktree workflows')
    .version(pkg.version)
    .option('--verbose', 'Show debug output (enables SHOW_COMMANDS, timing)')
    .option('--quiet', 'Suppress non-essential output')
    .hook('preAction', (thisCommand) => {
      const verbose = thisCommand.opts().verbose === true;
      const quiet = thisCommand.opts().quiet === true;
      setVerbosity(verbose, quiet);
      if (verbose) {
        process.env.SHOW_COMMANDS = '1';
      }
    });

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
  program.addCommand(threadsCommand());
  program.addCommand(shortcutCommand());
  program.addCommand(guidelinesCommand());
  program.addCommand(templateCommand());
  program.addCommand(launchCommand());
  program.addCommand(watchCommand());
  program.addCommand(goCommand());
  return program;
}
