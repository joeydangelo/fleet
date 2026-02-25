import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import pc from 'picocolors';
import { loadRepoConfig } from '../lib/config.js';
import type { PawConfig } from '../lib/config.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import {
  createTmuxService,
  tmuxSessionName,
  launchTmux,
  launchDetached,
  isInsideTmux,
  ensureTmuxInstalled,
} from '../lib/tmux.js';
import { savePanes, saveDetachedAgents, readPaneConfig } from '../lib/pane-state.js';
import { SIDEBAR_WIDTH } from '../lib/tui-helpers.js';
import { success, skip, error, pending, handleError, colors } from '../lib/output.js';

/** Spawn agents in tmux sessions (attached or detached) for tasks that aren't done. */
export async function runLaunch(
  repoRoot: string,
  config: PawConfig,
  opts?: { detached?: boolean; task?: string },
): Promise<void> {
  if (!config.agent) {
    throw new Error('No agent configured. Add an agent field to .paw/paw.yaml:\n\n  agent: claude');
  }

  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);
  const sessionName = tmuxSessionName(basename(repoRoot));

  const targets = opts?.task ? worktrees.filter((wt) => wt.taskName === opts.task) : worktrees;

  if (opts?.task && targets.length === 0) {
    throw new Error(`Task not found: ${opts.task}`);
  }

  const useDetached = opts?.detached || !isInsideTmux();
  const modeLabel = useDetached ? 'detached' : 'attached';

  console.log(pc.bold(`paw launch: ${targets.length} task(s)`));
  console.log(`  agent: ${config.agent}`);
  console.log(`  session: ${sessionName}`);
  console.log(`  mode: ${modeLabel}\n`);

  const launchList: Array<{ taskName: string; worktreePath: string; agentCommand: string }> = [];

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

    launchList.push({
      taskName: wt.taskName,
      worktreePath: wt.worktreePath,
      agentCommand: config.agent,
    });
  }

  if (launchList.length === 0) {
    console.log(pc.dim('No tasks to launch.'));
    return;
  }

  const tmux = createTmuxService();

  if (useDetached) {
    const existing = readPaneConfig(repoRoot);
    const existingAgents = existing?.detached ?? [];
    const newAgents = await launchDetached(tmux, sessionName, launchList, existingAgents);

    const newTaskNames = new Set(newAgents.map((a) => a.taskName));
    const keptAgents = existingAgents.filter(
      (a) => !newTaskNames.has(a.taskName) && tmux.sessionExists(a.sessionName),
    );
    saveDetachedAgents(repoRoot, sessionName, [...keptAgents, ...newAgents]);

    for (const agent of newAgents) {
      success(agent.taskName, agent.worktreePath);
    }

    console.log(pc.dim(`\nLaunched ${newAgents.length} agent(s) in detached tmux sessions.`));
  } else {
    const existing = readPaneConfig(repoRoot);
    const existingPanes = existing?.panes ?? [];
    const livePaneIds = new Set(tmux.listPanes(sessionName));
    for (const ep of existingPanes) {
      if (launchList.some((l) => l.taskName === ep.taskName)) {
        if (livePaneIds.has(ep.paneId)) {
          skip(ep.taskName, `pane ${ep.paneId} alive in tmux`);
        } else {
          pending(ep.taskName, `pane ${ep.paneId} gone — will relaunch`);
        }
      }
    }
    const newPanes = await launchTmux(tmux, sessionName, repoRoot, launchList, existingPanes);
    const postLivePaneIds = new Set(tmux.listPanes(sessionName));
    const livePanes = (existing?.panes ?? []).filter((p) => postLivePaneIds.has(p.paneId));
    const newTaskNames = new Set(newPanes.map((p) => p.taskName));
    const allPanes = [...livePanes.filter((p) => !newTaskNames.has(p.taskName)), ...newPanes];
    savePanes(repoRoot, sessionName, allPanes, existing?.orchestratorPaneId ?? '');
    tmux.pinSidebarLayout(sessionName, SIDEBAR_WIDTH);

    for (const pane of newPanes) {
      success(pane.taskName, pane.worktreePath);
    }

    console.log(pc.dim(`\nLaunched ${newPanes.length} agent(s) in tmux session: ${sessionName}`));
  }
}

interface LaunchOpts {
  config?: string;
  dryRun?: boolean;
  task?: string;
  detached?: boolean;
}

export function launchCommand(): Command {
  return new Command('launch')
    .description('Spawn agents in tmux panes for each task worktree')
    .option('-c, --config <path>', 'Path to .paw/paw.yaml')
    .option('--dry-run', 'Show what would be spawned without launching')
    .option('-t, --task <name>', 'Launch agent in a specific worktree only')
    .option('--detached', 'Force detached mode (background tmux sessions)')
    .action(async (opts: LaunchOpts) => {
      try {
        if (!opts.dryRun) ensureTmuxInstalled();
        const { repoRoot, config } = loadRepoConfig(opts.config);

        if (opts.dryRun) {
          const worktrees = planWorktrees(config, repoRoot);
          const syncState = readSyncState(repoRoot);
          const useDetached = opts.detached || !isInsideTmux();
          const sessionName = tmuxSessionName(basename(repoRoot));
          const targets = opts.task
            ? worktrees.filter((wt) => wt.taskName === opts.task)
            : worktrees;

          if (opts.task && targets.length === 0) {
            console.error(colors.error(`Task not found: ${opts.task}`));
            process.exit(1);
          }

          console.log(pc.bold(`paw launch: ${targets.length} task(s) (dry run)`));
          console.log(`  agent: ${config.agent}`);
          console.log(`  session: ${sessionName}`);
          console.log(`  mode: ${useDetached ? 'detached' : 'attached'}\n`);

          for (const wt of targets) {
            const taskState = syncState?.tasks[wt.taskName];
            if (taskState?.status === 'done') {
              skip(wt.taskName, 'done');
            } else if (!existsSync(wt.worktreePath)) {
              error(wt.taskName, 'worktree not found -- run paw up first');
            } else {
              const verb = useDetached ? 'tmux new-session -d' : 'tmux split-window';
              pending(wt.taskName, `${verb} -c ${wt.worktreePath} → ${config.agent}`);
            }
          }
          console.log(pc.dim('\nDry run -- no sessions opened.'));
          return;
        }

        await runLaunch(repoRoot, config, {
          detached: opts.detached,
          task: opts.task,
        });
      } catch (err) {
        handleError(err);
      }
    });
}
