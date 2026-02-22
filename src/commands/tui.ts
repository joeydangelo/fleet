import { basename } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { getRepoRoot } from '../lib/git.js';
import { createTmuxService, tmuxSessionName, isInsideTmux, requireTmux } from '../lib/tmux.js';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';
import { restorePanes } from '../lib/pane-state.js';
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
      onQuit,
    }),
  );
}

/**
 * Entry point for `paw` (bare command). Always renders the TUI when inside tmux.
 *
 * Inside tmux: switches to the paw session and renders the TUI in the current pane.
 * Outside tmux (new session): creates the session, bootstraps the TUI via send-keys, then attaches.
 * Outside tmux (existing session): attaches directly — TUI should already be running in pane 0.
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

    const panes = restorePanes(tmux, sessionName, repoRoot);

    if (isInsideTmux()) {
      const controlPaneId = tmux.getCurrentPaneId();
      try {
        tmux.switchClient(sessionName);
      } catch {
        // Already in this session — switchClient is a no-op in that case
      }
      runTuiSidebar(tmux, sessionName, repoRoot, panes, controlPaneId);
    } else {
      if (isNewSession) {
        // Bootstrap: send 'paw' into the session so TUI renders immediately on attach
        tmux.sendKeys(sessionName, 'paw');
      }
      tmux.attachSession(sessionName);
    }
  } catch (err) {
    handleError(err);
  }
}
