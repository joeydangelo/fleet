import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import pc from 'picocolors';
import { loadRepoConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import { createTmuxService, tmuxSessionName, launchTmux, requireTmux } from '../lib/tmux.js';
import { savePanes, readPaneConfig } from '../lib/pane-state.js';
import { SIDEBAR_WIDTH } from '../lib/tui-helpers.js';
import { success, skip, error, pending, handleError, colors } from '../lib/output.js';

interface LaunchOpts {
  config?: string;
  dryRun?: boolean;
  task?: string;
}

export function launchCommand(): Command {
  return new Command('launch')
    .description('Spawn agents in tmux panes for each task worktree')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--dry-run', 'Show what would be spawned without launching')
    .option('-t, --task <name>', 'Launch agent in a specific worktree only')
    .action((opts: LaunchOpts) => {
      try {
        if (!opts.dryRun) requireTmux();
        const { repoRoot, config } = loadRepoConfig(opts.config);

        if (!config.agent) {
          console.error(
            colors.error(
              'No agent configured. Add an agent field to .paw/paw.yaml:\n\n  agent: claude\n',
            ),
          );
          process.exit(1);
        }

        const worktrees = planWorktrees(config, repoRoot);
        const syncState = readSyncState(repoRoot);
        const sessionName = tmuxSessionName(basename(repoRoot));

        // Filter to a specific task if --task is provided
        const targets = opts.task ? worktrees.filter((wt) => wt.taskName === opts.task) : worktrees;

        if (opts.task && targets.length === 0) {
          console.error(colors.error(`Task not found: ${opts.task}`));
          process.exit(1);
        }

        console.log(
          pc.bold(`paw launch: ${targets.length} task(s)${opts.dryRun ? ' (dry run)' : ''}`),
        );
        console.log(`  agent: ${config.agent}`);
        console.log(`  session: ${sessionName}\n`);

        const launchList: Array<{ taskName: string; worktreePath: string; agentCommand: string }> =
          [];

        for (const wt of targets) {
          const taskState = syncState?.tasks[wt.taskName];

          if (taskState?.status === 'done') {
            skip(wt.taskName, 'done');
            continue;
          }

          if (!existsSync(wt.worktreePath)) {
            error(wt.taskName, 'worktree not found -- run paw up first');
            continue;
          }

          if (opts.dryRun) {
            pending(wt.taskName, `tmux split-window -c ${wt.worktreePath} → ${config.agent}`);
          } else {
            launchList.push({
              taskName: wt.taskName,
              worktreePath: wt.worktreePath,
              agentCommand: config.agent,
            });
          }
        }

        if (opts.dryRun) {
          console.log(pc.dim('\nDry run -- no panes opened.'));
          return;
        }

        if (launchList.length === 0) {
          console.log(pc.dim('No tasks to launch.'));
          return;
        }

        const tmux = createTmuxService();
        const existing = readPaneConfig(repoRoot);
        const newPanes = launchTmux(tmux, sessionName, repoRoot, launchList, existing?.panes ?? []);
        // Merge: keep existing live panes, append newly created ones.
        const allPanes = [...(existing?.panes ?? []), ...newPanes];
        savePanes(repoRoot, sessionName, allPanes, existing?.orchestratorPaneId ?? '');
        // Re-enforce sidebar layout after adding agent panes.
        tmux.pinSidebarLayout(sessionName, SIDEBAR_WIDTH);

        for (const pane of newPanes) {
          success(pane.taskName, pane.worktreePath);
        }

        console.log(
          pc.dim(`\nLaunched ${newPanes.length} agent(s) in tmux session: ${sessionName}`),
        );
      } catch (err) {
        handleError(err);
      }
    });
}
