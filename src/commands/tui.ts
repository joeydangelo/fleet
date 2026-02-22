import { basename } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { getRepoRoot } from '../lib/git.js';
import { createTmuxService, tmuxSessionName, isInsideTmux, requireTmux } from '../lib/tmux.js';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';
import { restorePanes, savePanes } from '../lib/pane-state.js';
import { TuiApp } from '../components/tui-app.js';
import { handleError, colors } from '../lib/output.js';
import { SIDEBAR_WIDTH } from '../lib/tui-helpers.js';

/** Render the TUI sidebar in the current pane via Ink. */
function runTuiSidebar(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  panes: PawPane[],
  controlPaneId: string,
  orchestratorPaneId: string,
): void {
  tmux.resizePane(controlPaneId, SIDEBAR_WIDTH);
  tmux.pinSidebarLayout(sessionName, SIDEBAR_WIDTH);

  const onQuit = () => {
    // Clear screen and print reattach hint
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(colors.info(`\n  Run \`paw\` to resume. Session: ${sessionName}\n`));
    process.exit(0);
  };

  render(
    React.createElement(TuiApp, {
      sessionName,
      repoRoot,
      tmux,
      panes,
      controlPaneId,
      orchestratorPaneId,
      onQuit,
    }),
  );
}

/**
 * Entry point for `paw` (bare command). Always brings the user into the paw workspace.
 *
 * - Already in paw session: renders the TUI in the current pane (start or restart).
 * - Inside a different tmux session: switches the client over; TUI is already running.
 * - Outside tmux, new session: creates session with orchestrator shell (pane 1),
 *   bootstraps TUI in pane 0 via send-keys, then attaches.
 * - Outside tmux, existing session: ensures orchestrator pane exists, then attaches.
 */
export function runTui(): void {
  try {
    requireTmux();
    const repoRoot = getRepoRoot();
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
        // Already in the paw session — render TUI in the current pane.
        const controlPaneId = tmux.getCurrentPaneId();
        runTuiSidebar(tmux, sessionName, repoRoot, panes, controlPaneId, existingOrchestratorId);
      } else {
        // Different session — switch over; TUI was bootstrapped by `paw launch`.
        tmux.switchClient(sessionName);
      }
    } else {
      if (isNewSession) {
        // New session: pane 0 is the TUI control pane; create pane 1 as the
        // orchestrator shell where the user will type their AI agent command.
        // Use horizontal split (-h) so the orchestrator appears to the RIGHT,
        // keeping the TUI sidebar on the LEFT (same approach as dmux).
        const controlPaneId = tmux.listPanes(sessionName)[0] ?? '';
        const orchestratorPaneId = tmux.createPane(sessionName, repoRoot, { horizontal: true });
        tmux.setPaneTitle(orchestratorPaneId, 'paw-orchestrator');
        tmux.setPaneRole(orchestratorPaneId, 'paw-orchestrator');
        savePanes(repoRoot, sessionName, panes, orchestratorPaneId);
        // Lock sidebar width from the external process before attaching so the
        // user sees the correct layout immediately on attach.
        tmux.resizePane(controlPaneId, SIDEBAR_WIDTH);
        // Bootstrap TUI in the control pane (pane 0) so it's ready on attach.
        tmux.sendKeys(controlPaneId, 'paw');
      } else if (!existingOrchestratorId) {
        // Existing session without an orchestrator pane (pre-feature sessions).
        const orchestratorPaneId = tmux.createPane(sessionName, repoRoot, { horizontal: true });
        tmux.setPaneTitle(orchestratorPaneId, 'paw-orchestrator');
        tmux.setPaneRole(orchestratorPaneId, 'paw-orchestrator');
        savePanes(repoRoot, sessionName, panes, orchestratorPaneId);
      }
      tmux.attachSession(sessionName);
    }
  } catch (err) {
    handleError(err);
  }
}
