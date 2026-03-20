import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import pc from 'picocolors';
import type { FleetConfig } from '../lib/config.js';
import { loadSessionContext } from '../lib/session-context.js';
import { planWorktrees } from '../lib/session.js';
import { readSyncState } from '../lib/sync.js';
import {
  createTmuxService,
  tmuxSessionName,
  launchDetached,
  ensureTmuxInstalled,
  ensureNativeFilesystem,
} from '../lib/tmux.js';
import { saveDetachedAgents, readPaneConfig } from '../lib/pane-state.js';
import { success, skip, error, pending, handleError, formatTaskStatus } from '../lib/output.js';
import { writeHeartbeat } from '../lib/health.js';
import { emitEvent } from '../lib/feed.js';
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
export function printLaunchPreview(targets: WorktreeInfo[], syncState: SyncState | null): void {
  for (const wt of targets) {
    const taskState = syncState?.tasks[wt.taskName];
    if (taskState?.status === 'done' || taskState?.status === 'in_review') {
      skip(wt.taskName, formatTaskStatus(taskState.status));
    } else if (!existsSync(wt.worktreePath)) {
      error(wt.taskName, 'worktree not found -- run fleet up first');
    } else {
      pending(wt.taskName, `tmux new-session -d -c ${wt.worktreePath} → claude`);
    }
  }
}

/** Spawn agents in detached tmux sessions for tasks that aren't done. */
export async function runLaunch(
  repoRoot: string,
  config: FleetConfig,
  opts?: { quiet?: boolean },
): Promise<number> {
  const quiet = opts?.quiet ?? false;
  const worktrees = planWorktrees(config, repoRoot);
  const syncState = readSyncState(repoRoot);
  const sessionName = tmuxSessionName(basename(repoRoot));

  if (!quiet) {
    console.log(pc.bold(`fleet launch: ${worktrees.length} task(s)`));
    console.log(`  agent: claude`);
    console.log(`  session: ${sessionName}`);
    console.log(`  mode: detached\n`);
  }

  const launchList: Array<{ taskName: string; worktreePath: string; agentCommand: string }> = [];

  for (const wt of worktrees) {
    const taskState = syncState?.tasks[wt.taskName];

    if (taskState?.status === 'done' || taskState?.status === 'in_review') {
      if (!quiet) skip(wt.taskName, formatTaskStatus(taskState.status));
      continue;
    }

    if (!existsSync(wt.worktreePath)) {
      if (!quiet) error(wt.taskName, 'worktree not found -- run fleet up first');
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
    if (!quiet) console.log(pc.dim('No tasks to launch.'));
    return 0;
  }

  const tmux = createTmuxService();

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
    if (!quiet) success(agent.taskName, agent.worktreePath);
  }

  emitEvent({ event: 'fleet.launch', tasks: newAgents.map((a) => a.taskName) });
  if (!quiet) {
    console.log(pc.dim(`\nLaunched ${newAgents.length} agent(s) in detached tmux sessions.`));
  }

  return newAgents.length;
}

/** Build the `fleet launch` CLI command. */
export function launchCommand(): Command {
  return new Command('launch')
    .description('Spawn agents in detached tmux sessions for each task worktree')
    .option('--dry-run', 'Show what would be spawned without launching')
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        if (!opts.dryRun) ensureTmuxInstalled();
        const { repoRoot, config, worktrees, syncState } = loadSessionContext();
        if (!opts.dryRun) ensureNativeFilesystem(repoRoot);

        if (opts.dryRun) {
          const sessionName = tmuxSessionName(basename(repoRoot));

          console.log(pc.bold(`fleet launch: ${worktrees.length} task(s) (dry run)`));
          console.log(`  agent: claude`);
          console.log(`  session: ${sessionName}`);
          console.log(`  mode: detached\n`);

          printLaunchPreview(worktrees, syncState);
          console.log(pc.dim('\nDry run -- no sessions opened.'));
          return;
        }

        await runLaunch(repoRoot, config);
      } catch (err) {
        handleError(err);
      }
    });
}
