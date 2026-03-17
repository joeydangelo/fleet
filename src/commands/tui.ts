import { basename, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { getRepoRoot } from '../lib/git.js';
import {
  createTmuxService,
  tmuxSessionName,
  isInsideTmux,
  ensureTmuxInstalled,
  ensureNativeFilesystem,
} from '../lib/tmux.js';
import type { TmuxServiceApi, FleetPane } from '../lib/tmux.js';
import { restorePanes, savePanes, labelOrchestrator, writePaneConfig } from '../lib/pane-state.js';
import type { FleetPaneConfig } from '../lib/tmux.js';
import { TuiApp } from '../components/tui-app.js';
import { handleError, colors } from '../lib/output.js';
import { SIDEBAR_WIDTH, TUI_ROLE } from '../lib/constants.js';

/**
 * Add a new project to the current workspace. Creates an orchestrator pane
 * in the current tmux session for the selected project.
 */
function createAddProject(
  tmux: TmuxServiceApi,
  sessionName: string,
): (projectRoot: string) => void {
  return (projectRoot: string) => {
    const panes = tmux.listPanesDetailed(sessionName);
    const existing = panes.find((p) => p.project === projectRoot);
    if (existing) {
      tmux.selectPane(existing.paneId);
      return;
    }

    const fleetDir = resolve(projectRoot, '.fleet');
    if (!existsSync(fleetDir)) {
      mkdirSync(fleetDir, { recursive: true });
    }

    const paneId = tmux.createPane(sessionName, projectRoot);
    labelOrchestrator(tmux, paneId);
    tmux.setPaneProject(paneId, projectRoot);

    const config: FleetPaneConfig = {
      sessionName,
      repoRoot: projectRoot,
      orchestratorPaneId: paneId,
      panes: [],
      lastUpdated: new Date().toISOString(),
    };
    writePaneConfig(projectRoot, config);

    tmux.sendKeys(paneId, 'claude');

    // New pane won't stack correctly until the sidebar layout is re-pinned.
    try {
      tmux.pinSidebarLayout(sessionName, SIDEBAR_WIDTH);
    } catch {
      // Best-effort
    }
  };
}

/** Render the TUI sidebar in the current pane via Ink. */
function runTuiSidebar(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  panes: FleetPane[],
  controlPaneId: string,
): void {
  const existingPanes = tmux.listPanesDetailed(sessionName);
  const existingTui = existingPanes.find((p) => p.role === TUI_ROLE && p.paneId !== controlPaneId);
  if (existingTui) {
    console.error(colors.error('fleet TUI is already running in this session.'));
    console.error(
      colors.info(
        `  Switch to pane ${existingTui.paneId} or press q to quit the existing TUI first.`,
      ),
    );
    process.exit(1);
  }

  tmux.resizePane(controlPaneId, SIDEBAR_WIDTH);
  tmux.pinSidebarLayout(sessionName, SIDEBAR_WIDTH);

  try {
    tmux.setPaneRole(controlPaneId, TUI_ROLE);
    tmux.setPaneProject(controlPaneId, repoRoot);
  } catch {
    // Best-effort
  }

  const onQuit = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(colors.info(`\n  Run \`fleet\` to resume. Session: ${sessionName}\n`));
    process.exit(0);
  };

  render(
    React.createElement(TuiApp, {
      sessionName,
      repoRoot,
      tmux,
      panes,
      controlPaneId,
      onQuit,
      addProject: createAddProject(tmux, sessionName),
    }),
  );
}

/**
 * Entry point for `fleet tui`. Always brings the user into the fleet workspace.
 *
 * - Already in fleet session: renders the TUI in the current pane (start or restart).
 * - Inside a different tmux session: switches the client over; TUI is already running.
 * - Outside tmux, new session: creates session with orchestrator shell (pane 1),
 *   bootstraps TUI in pane 0 via send-keys, then attaches.
 * - Outside tmux, existing session: ensures orchestrator pane exists, then attaches.
 */
function runTui(): void {
  ensureTmuxInstalled();
  const repoRoot = getRepoRoot();
  ensureNativeFilesystem(repoRoot);
  const sessionName = tmuxSessionName(basename(repoRoot));
  const tmux = createTmuxService();

  const isNewSession = !tmux.sessionExists(sessionName);
  if (isNewSession) {
    tmux.createSession(sessionName, repoRoot);
  }

  const { panes, orchestratorPaneId: existingOrchestratorId } = restorePanes(
    tmux,
    sessionName,
    repoRoot,
  );

  if (isInsideTmux()) {
    const currentSession = tmux.getCurrentSessionName();
    if (currentSession === sessionName) {
      // Use $TMUX_PANE (set per-pane by tmux) rather than display-message -p
      // which returns the *active* pane — after layout operations that may be
      // the orchestrator, not the TUI.
      const controlPaneId = process.env['TMUX_PANE'] ?? tmux.getCurrentPaneId();
      runTuiSidebar(tmux, sessionName, repoRoot, panes, controlPaneId);
    } else {
      // TUI was already bootstrapped by `fleet launch`.
      tmux.switchClient(sessionName);
    }
  } else {
    if (isNewSession) {
      // Horizontal split places orchestrator RIGHT, TUI sidebar LEFT.
      const controlPaneId = tmux.listPanes(sessionName)[0] ?? '';
      const orchestratorPaneId = tmux.createPane(sessionName, repoRoot, { horizontal: true });
      labelOrchestrator(tmux, orchestratorPaneId);
      tmux.setPaneProject(orchestratorPaneId, repoRoot);
      savePanes(repoRoot, sessionName, panes, orchestratorPaneId);
      // Lock sidebar width before attaching so the user sees correct layout immediately.
      tmux.resizePane(controlPaneId, SIDEBAR_WIDTH);
      tmux.sendKeys(controlPaneId, 'fleet tui');
    } else if (!existingOrchestratorId) {
      // Handle pre-feature sessions that lack an orchestrator pane.
      const orchestratorPaneId = tmux.createPane(sessionName, repoRoot, { horizontal: true });
      labelOrchestrator(tmux, orchestratorPaneId);
      tmux.setPaneProject(orchestratorPaneId, repoRoot);
      savePanes(repoRoot, sessionName, panes, orchestratorPaneId);
    }
    tmux.attachSession(sessionName);
  }
}

/** Build the `fleet tui` CLI command. */
export function tuiCommand(): Command {
  return new Command('tui')
    .description('Open the tmux TUI (optional — fleet go runs detached by default)')
    .action(() => {
      try {
        runTui();
      } catch (err) {
        handleError(err);
      }
    });
}
