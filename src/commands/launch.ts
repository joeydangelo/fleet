import { Command } from 'commander';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { getRepoRoot } from '../lib/git.js';
import { loadConfig, resolveConfigPath } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import {
  buildLaunchCommand,
  spawnTerminal,
  detectPlatform,
  readPidFile,
  writePidFile,
} from '../lib/launcher.js';
import { success, skip, error, pending, handleError } from '../lib/output.js';

interface LaunchOpts {
  config?: string;
  dryRun?: boolean;
  task?: string;
  terminal?: string;
}

export function launchCommand(): Command {
  return new Command('launch')
    .description('Open a terminal with the agent command for each task worktree')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--dry-run', 'Show what would be spawned without launching')
    .option('-t, --task <name>', 'Launch agent in a specific worktree only')
    .option('--terminal <emulator>', 'Override terminal emulator (Linux)')
    .action(async (opts: LaunchOpts) => {
      try {
        const repoRoot = getRepoRoot();
        const configPath = opts.config ?? resolveConfigPath(repoRoot);
        const config = loadConfig(configPath);

        if (!config.agent) {
          console.error(
            pc.red(
              'No agent configured. Add an agent field to .paw/paw.yaml:\n\n  agent: claude\n',
            ),
          );
          process.exit(1);
        }

        const worktrees = planWorktrees(config, repoRoot);
        const syncState = readSyncState(repoRoot);
        const platform = detectPlatform();

        // Filter to a specific task if --task is provided
        const targets = opts.task ? worktrees.filter((wt) => wt.taskName === opts.task) : worktrees;

        if (opts.task && targets.length === 0) {
          console.error(pc.red(`Task not found: ${opts.task}`));
          process.exit(1);
        }

        console.log(
          pc.bold(`paw launch: ${targets.length} task(s)${opts.dryRun ? ' (dry run)' : ''}`),
        );
        console.log(`  agent: ${config.agent}`);
        console.log(`  platform: ${platform}\n`);

        let launched = 0;
        // Read existing PIDs so re-launches append rather than overwrite
        const trackedPids = readPidFile(repoRoot);

        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        for (const wt of targets) {
          const taskState = syncState?.tasks[wt.taskName];

          // Skip done tasks
          if (taskState?.status === 'done') {
            skip(wt.taskName, 'done');
            continue;
          }

          // Skip worktrees that don't exist
          if (!existsSync(wt.worktreePath)) {
            error(wt.taskName, 'worktree not found -- run paw up first');
            continue;
          }

          const launchOpts = {
            worktreePath: wt.worktreePath,
            agentCommand: config.agent,
            terminal: opts.terminal,
          };

          if (opts.dryRun) {
            const result = buildLaunchCommand(launchOpts, platform);
            pending(wt.taskName, `${result.command} ${result.args.join(' ')}`);
          } else {
            // Stagger launches so concurrent Claude instances don't race on
            // ~/.claude.json initialization and corrupt the file.
            if (launched > 0) await sleep(1500);
            try {
              const pid = spawnTerminal(launchOpts, platform);
              if (pid !== undefined) {
                trackedPids[wt.taskName] = pid;
              }
              success(wt.taskName, wt.worktreePath);
              launched++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              error(wt.taskName, `failed to launch: ${msg}`);
            }
          }
        }

        // Persist tracked PIDs so `paw down` can kill them later
        if (!opts.dryRun && Object.keys(trackedPids).length > 0) {
          writePidFile(repoRoot, trackedPids);
        }

        if (opts.dryRun) {
          console.log(pc.dim('\nDry run -- no terminals opened.'));
          return;
        }

        if (launched > 0) {
          console.log(pc.dim(`\nLaunched ${launched} agent(s).`));
        }
      } catch (err) {
        handleError(err);
      }
    });
}
