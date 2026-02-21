import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';

interface TuiAppProps {
  sessionName: string;
  tmux: TmuxServiceApi;
  panes: PawPane[];
  onQuit: () => void;
}

/**
 * Minimal Ink TUI for paw — shows pane list with status indicators.
 * Runs as a sidebar pane inside the tmux session.
 */
export function TuiApp({ sessionName, tmux, panes: initialPanes, onQuit }: TuiAppProps) {
  const { exit } = useApp();
  const [panes, setPanes] = useState(initialPanes);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Refresh pane list periodically
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const tmuxPanes = tmux.listPanes(sessionName);
        setPanes(
          (current) =>
            current.map((p) => ({
              ...p,
              _alive: tmuxPanes.includes(p.paneId),
            })) as PawPane[],
        );
      } catch {
        // Session might not exist yet
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionName, tmux]);

  useInput((input, key) => {
    if (input === 'q') {
      onQuit();
      exit();
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(panes.length - 1, i + 1));
    }

    // Jump to pane on Enter
    if (key.return && panes[selectedIndex]) {
      const pane = panes[selectedIndex];
      try {
        tmux.sendKeys(pane.paneId, '');
      } catch {
        // Pane may no longer exist
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>paw</Text>
        <Text dimColor> — {sessionName}</Text>
      </Box>

      <Box flexDirection="column">
        {panes.length === 0 ? (
          <Text dimColor>No panes. Run `paw launch` to spawn agents.</Text>
        ) : (
          panes.map((pane, i) => (
            <Box key={pane.id}>
              <Text color={i === selectedIndex ? 'cyan' : undefined}>
                {i === selectedIndex ? '>' : ' '} {pane.taskName}
              </Text>
              <Text dimColor> ({pane.agent})</Text>
            </Box>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>j/k: navigate | Enter: focus | q: quit</Text>
      </Box>
    </Box>
  );
}
