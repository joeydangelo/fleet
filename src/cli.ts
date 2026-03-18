import { Command, Option } from 'commander';
import { setVerbosity, setColorOption, type ColorOption } from './lib/context.js';
import { resetColors } from './lib/output.js';
import { getVersion } from './lib/version.js';

/**
 * Register a lazily-loaded subcommand. The command module is only imported
 * when the command is actually invoked, keeping startup fast.
 *
 * Approach: register a thin placeholder that accepts all args/options.
 * When invoked, load the real command module and re-parse argv through it.
 */
function lazy(
  program: Command,
  name: string,
  description: string,
  loader: () => Promise<Command>,
): void {
  const placeholder = new Command(name)
    .description(description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false);

  placeholder.action(async () => {
    const realCommand = await loader();

    const argv = ['node', name, ...process.argv.slice(3)];
    await realCommand.parseAsync(argv);
  });

  program.addCommand(placeholder);
}

/** Build the top-level CLI program with all subcommands registered lazily. */
export function createCli(): Command {
  const program = new Command();

  program
    .name('fleet')
    .description('Parallel Agent Worktrees -- orchestrate multi-agent git worktree workflows')
    .version(getVersion())
    .option('--verbose', 'Show debug output (enables SHOW_COMMANDS, timing)')
    .addOption(
      new Option('--color <when>', 'Colorize output: auto, always, never')
        .choices(['auto', 'always', 'never'])
        .default('auto'),
    )
    .hook('preAction', (thisCommand) => {
      const verbose = thisCommand.opts().verbose === true;
      setVerbosity(verbose);
      if (verbose) {
        process.env.SHOW_COMMANDS = '1';
      }
      const colorOpt = thisCommand.opts().color as ColorOption;
      setColorOption(colorOpt);
      resetColors();
    });

  program.addHelpText(
    'after',
    `
Quickstart:
  fleet go                 Run the full lifecycle (detached by default)

IMPORTANT:
  Agents unfamiliar with fleet should run \`fleet prime\` for full context.

Getting Started:
  npm install -g get-fleet@latest && fleet init`,
  );

  lazy(program, 'init', 'Initialize fleet in a repo', async () => {
    const m = await import('./commands/init.js');
    return m.initCommand();
  });
  lazy(program, 'up', 'Create worktrees and branches for all tasks', async () => {
    const m = await import('./commands/up.js');
    return m.upCommand();
  });
  lazy(
    program,
    'prime',
    'Context management — orchestrator dashboard or worktree orientation',
    async () => {
      const m = await import('./commands/prime.js');
      return m.primeCommand();
    },
  );
  lazy(program, 'status', 'Check progress of all task worktrees', async () => {
    const m = await import('./commands/status.js');
    return m.statusCommand();
  });
  lazy(program, 'review', 'Submit task for review — push branch and create PR first', async () => {
    const m = await import('./commands/review.js');
    return m.reviewCommand();
  });
  lazy(program, 'merge', 'Merge done task branches into the target branch', async () => {
    const m = await import('./commands/merge.js');
    return m.mergeCommand();
  });
  lazy(program, 'down', 'Remove all task worktrees and clean up', async () => {
    const m = await import('./commands/down.js');
    return m.downCommand();
  });
  lazy(program, 'broadcast', 'Broadcast a message to all agents', async () => {
    const m = await import('./commands/broadcast.js');
    return m.broadcastCommand();
  });
  lazy(program, 'send', 'Send a direct message to an agent', async () => {
    const m = await import('./commands/send.js');
    return m.sendCommand();
  });
  lazy(program, 'reply', 'Reply to a direct message from an agent', async () => {
    const m = await import('./commands/reply.js');
    return m.replyCommand();
  });
  lazy(program, 'shortcut', 'Display a shortcut workflow', async () => {
    const m = await import('./commands/shortcut.js');
    return m.shortcutCommand();
  });
  lazy(program, 'guidelines', 'Display a coding guideline', async () => {
    const m = await import('./commands/guidelines.js');
    return m.guidelinesCommand();
  });
  lazy(program, 'template', 'Display a document template', async () => {
    const m = await import('./commands/template.js');
    return m.templateCommand();
  });
  lazy(program, 'launch', 'Spawn agents in tmux panes for each task worktree', async () => {
    const m = await import('./commands/launch.js');
    return m.launchCommand();
  });
  lazy(program, 'dashboard', 'Terminal dashboard for fleet sessions', async () => {
    const m = await import('./commands/dashboard.js');
    return m.dashboardCommand();
  });
  lazy(program, 'watch', 'Continuously monitor agent progress', async () => {
    const m = await import('./commands/watch.js');
    return m.watchCommand();
  });
  lazy(program, 'go', 'Run the full lifecycle: up → launch → watch → merge → down', async () => {
    const m = await import('./commands/go.js');
    return m.goCommand();
  });
  lazy(program, 'heartbeat', 'Record agent activity (called by hooks)', async () => {
    const m = await import('./commands/heartbeat.js');
    return m.heartbeatCommand();
  });
  lazy(program, 'inbox', 'Check for messages, broadcasts, and open threads', async () => {
    const m = await import('./commands/inbox.js');
    return m.inboxCommand();
  });
  lazy(program, 'nudge', 'Send a message to an agent via file-based delivery', async () => {
    const m = await import('./commands/nudge.js');
    return m.nudgeCommand();
  });
  lazy(program, 'summary', 'Write, read, or append task summary on the sync branch', async () => {
    const m = await import('./commands/summary.js');
    return m.summaryCommand();
  });
  lazy(program, 'feed', 'Live-tail the NDJSON event feed', async () => {
    const m = await import('./commands/feed.js');
    return m.feedCommand();
  });
  return program;
}
