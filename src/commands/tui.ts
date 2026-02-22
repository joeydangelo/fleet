import { basename } from 'node:path';
import { render } from 'ink';
import React from 'react';
import { getRepoRoot } from '../lib/git.js';
import {
  createTmuxService,
  tmuxSessionName,
  isInsideTmux,
  attachToTmuxSession,
  requireTmux,
} from '../lib/tmux.js';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';
import { restorePanes } from '../lib/pane-state.js';
import { TuiApp } from '../components/tui-app.js';
import { handleError, colors } from '../lib/output.js';

/**
 * Run the TUI sidebar inside a tmux pane. The TUI is an Ink app that
 * shows pane status and navigation. It runs in pane 0 of the tmux session.
 */
function runTuiSidebar(
  tmux: TmuxServiceApi,
  sessionName: string,
  repoRoot: string,
  panes: PawPane[],
): void {
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
    requireTmux();
    const repoRoot = getRepoRoot();
    const sessionName = tmuxSessionName(basename(repoRoot));
    const tmux = createTmuxService();

    if (tmux.sessionExists(sessionName)) {
      attachToTmuxSession(tmux, sessionName);
      console.log(colors.info(`\n  Run \`paw\` to resume. Session: ${sessionName}\n`));
      return;
    }

    tmux.createSession(sessionName, repoRoot);

    const panes = restorePanes(tmux, sessionName, repoRoot);

    if (isInsideTmux()) {
      tmux.switchClient(sessionName);
    }

    runTuiSidebar(tmux, sessionName, repoRoot, panes);
  } catch (err) {
    handleError(err);
  }
}
