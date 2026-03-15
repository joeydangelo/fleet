import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import pc from 'picocolors';
import { loadRepoConfig } from '../lib/config.js';
import type { FleetConfig } from '../lib/config.js';
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
import { SIDEBAR_WIDTH } from '../lib/constants.js';
import { success, skip, error, pending, handleError, formatTaskStatus } from '../lib/output.js';
import { writeHeartbeat } from '../lib/health.js';
import type { WorktreeInfo } from '../lib/session.js';
import type { SyncState } from '../lib/sync.js';

const SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';
const MODEL_FLAG = '--model';

/** Ensure the agent command includes the permissionless flag. */
function ensurePermissionless(agentCommand: string): string {
  return agentCommand.includes(SKIP_PERMISSIONS_FLAG)
    ? agentCommand
    : `${agentCommand} ${SKIP_PERMISSIONS_FLAG}`;
}

/** Inject --model <model> into the agent command if not already present. */
function ensureModel(agentCommand: string, model: string): string {
  return agentCommand.includes(MODEL_FLAG)
    ? agentCommand
    : `${agentCommand} ${MODEL_FLAG} ${model}`;
}

/** Print per-task launch preview lines (shared by launch and go dry-run). */
export function printLaunchPreview(
  targets: WorktreeInfo[],
  syncState: SyncState | null,
  useDetached: boolean,
): void {
  for (const wt of targets) {
    const taskState = syncState?.tasks[wt.taskName];
    if (taskState?.status === 'done' || taskState?.status === 'in_review') {
      skip(wt.taskName, formatTaskStatus(taskState.status));
    } else if (!existsSync(wt.worktreePath)) {
      error(wt.taskName, 'worktree not found -- run fleet up first');
    } else {
      const verb = useDetached ? 'tmux new-session -d' : 'tmux split-window';
      pending(wt.taskName, `${verb} -c ${wt.worktreePath} → claude`);
    }
  }
}

/** Spawn agents for tasks that aren't done (detached by default; attached when inside tmux). */
export async function runLaunch(repoRoot: string, config: FleetConfig): Promise<void> {
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);
  const sessionName = tmuxSessionName(basename(repoRoot));

  const useDetached = !isInsideTmux();
  const modeLabel = useDetached ? 'detached' : 'attached';

  console.log(pc.bold(`fleet launch: ${worktrees.length} task(s)`));
  console.log(`  agent: claude`);
  console.log(`  session: ${sessionName}`);
  console.log(`  mode: ${modeLabel}\n`);

  const launchList: Array<{ taskName: string; worktreePath: string; agentCommand: string }> = [];

  for (const wt of worktrees) {
    const taskState = syncState?.tasks[wt.taskName];

    if (taskState?.status === 'done' || taskState?.status === 'in_review') {
      skip(wt.taskName, formatTaskStatus(taskState.status));
      continue;
    }

    if (!existsSync(wt.worktreePath)) {
      error(wt.taskName, 'worktree not found -- run fleet up first');
      continue;
    }

    // Always run agents permissionless — no human present to approve prompts
    const taskModel = config.tasks[wt.taskName]?.model ?? config.model;
    const agentCommand = taskModel
      ? ensureModel(ensurePermissionless('claude'), taskModel)
      : ensurePermissionless('claude');

    launchList.push({
      taskName: wt.taskName,
      worktreePath: wt.worktreePath,
      agentCommand,
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
      writeHeartbeat(repoRoot, agent.taskName);
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
      writeHeartbeat(repoRoot, pane.taskName);
      success(pane.taskName, pane.worktreePath);
    }

    console.log(pc.dim(`\nLaunched ${newPanes.length} agent(s) in tmux session: ${sessionName}`));
  }
}

/** Build the `fleet launch` CLI command. */
export function launchCommand(): Command {
  return new Command('launch')
    .description('Spawn agents for each task worktree (detached by default, attached in tmux)')
    .option('--dry-run', 'Show what would be spawned without launching')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        if (!opts.dryRun) ensureTmuxInstalled();
        const { repoRoot, config } = loadRepoConfig();

        if (opts.dryRun) {
          const worktrees = planWorktrees(config, repoRoot);
          const syncState = readSyncState(repoRoot);
          const useDetached = !isInsideTmux();
          const sessionName = tmuxSessionName(basename(repoRoot));

          console.log(pc.bold(`fleet launch: ${worktrees.length} task(s) (dry run)`));
          console.log(`  agent: claude`);
          console.log(`  session: ${sessionName}`);
          console.log(`  mode: ${useDetached ? 'detached' : 'attached'}\n`);

          printLaunchPreview(worktrees, syncState, useDetached);
          console.log(pc.dim('\nDry run -- no sessions opened.'));
          return;
        }

        await runLaunch(repoRoot, config);
      } catch (err) {
        handleError(err);
      }
    });
}
