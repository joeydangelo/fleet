import { basename } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { getRepoRoot } from '../lib/git.js';
import {
  createTmuxService,
  tmuxSessionName,
  isInsideTmux,
  attachToTmuxSession,
} from '../lib/tmux.js';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { TuiApp } from '../components/tui-app.js';
import { handleError, colors } from '../lib/output.js';

/**
 * Run the TUI sidebar inside a tmux pane. The TUI is an Ink app that
 * shows pane status and navigation. It runs in pane 0 of the tmux session.
 */
function runTuiSidebar(tmux: TmuxServiceApi, sessionName: string, panes: PawPane[]): void {
  const onQuit = () => {
    // Clear screen and print reattach hint
    process.stdout.write('\x1b[2J\x1b[H');
    console.log(colors.info(`\n  Run \`paw\` to resume. Session: ${sessionName}\n`));
    process.exit(0);
  };

  render(
    React.createElement(TuiApp, {
      sessionName,
      tmux,
      panes,
      onQuit,
    }),
  );
}

/**
 * Entry point for `paw` (bare command). Creates or reattaches to a tmux session.
 *
 * Behavior:
 * - If session exists: reattach (switch-client or attach-session)
 * - If no session: create session, start TUI sidebar in pane 0
 * - Idempotent: running `paw` twice reattaches
 */
export function runTui(): void {
  try {
    const repoRoot = getRepoRoot();
    const sessionName = tmuxSessionName(basename(repoRoot));
    const tmux = createTmuxService();

    if (tmux.sessionExists(sessionName)) {
      // Session exists — just reattach
      attachToTmuxSession(tmux, sessionName);
      console.log(colors.info(`\n  Run \`paw\` to resume. Session: ${sessionName}\n`));
      return;
    }

    // Create new session
    tmux.createSession(sessionName, repoRoot);

    // Load any persisted panes
    const paneConfig = readPaneConfig(repoRoot);
    const panes = paneConfig?.panes ?? [];

    // If we're already inside tmux, switch to the new session
    if (isInsideTmux()) {
      tmux.switchClient(sessionName);
    }

    // Run the TUI sidebar in the current pane
    runTuiSidebar(tmux, sessionName, panes);
  } catch (err) {
    handleError(err);
  }
}
