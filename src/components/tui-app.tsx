import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { TmuxServiceApi, PawPane } from '../lib/tmux.js';
import { readSyncState } from '../lib/sync.js';
import type { SyncState } from '../lib/sync.js';
import { agentBadge, taskDisplayStatus, statusIcon } from '../lib/tui-helpers.js';
import type { TuiStatus } from '../lib/tui-helpers.js';

const CARD_WIDTH = 40;
const LINE_WIDTH = 38; // CARD_WIDTH - 2 for border chars
const CONTENT_WIDTH = 36; // LINE_WIDTH - 2 for inner padding

interface PaneCardProps {
  pane: PawPane;
  status: TuiStatus;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  isNextSelected: boolean;
}

function PaneCard({ pane, status, selected, isFirst, isLast, isNextSelected }: PaneCardProps) {
  const { icon, color } = statusIcon(status);
  const badge = agentBadge(pane.agent);
  const borderColor = selected ? 'cyan' : 'gray';
  const bottomBorderColor = selected || isNextSelected ? 'cyan' : 'gray';

  return (
    <Box flexDirection="column" width={CARD_WIDTH}>
      {isFirst && (
        <Box>
          <Text color={borderColor}>╭</Text>
          <Text color={borderColor}>{'─'.repeat(LINE_WIDTH)}</Text>
          <Text color={borderColor}>╮</Text>
        </Box>
      )}
      <Box width={CARD_WIDTH}>
        <Text color={borderColor}>{'│ '}</Text>
        <Box width={CONTENT_WIDTH} justifyContent="space-between">
          <Box>
            <Text color={color}>{icon + ' '}</Text>
            <Text bold={selected} color={selected ? 'cyan' : 'white'}>
              {pane.taskName.substring(0, 25)}
            </Text>
          </Box>
          <Text color="gray">{badge}</Text>
        </Box>
        <Text color={borderColor}>{' │'}</Text>
      </Box>
      <Box>
        <Text color={bottomBorderColor}>{isLast ? '╰' : '├'}</Text>
        <Text color={bottomBorderColor}>{'─'.repeat(LINE_WIDTH)}</Text>
        <Text color={bottomBorderColor}>{isLast ? '╯' : '┤'}</Text>
      </Box>
    </Box>
  );
}

interface TuiAppProps {
  sessionName: string;
  repoRoot: string;
  tmux: TmuxServiceApi;
  panes: PawPane[];
  onQuit: () => void;
}

/**
 * Ink TUI for paw. Renders a fixed-width left panel showing task panes with
 * sync state status and agent badges. Runs in pane 0 of the tmux session.
 */
export function TuiApp({ sessionName, repoRoot, tmux, panes: initialPanes, onQuit }: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const [panes, setPanes] = useState(initialPanes);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [syncState, setSyncState] = useState<SyncState | null>(() => readSyncState(repoRoot));

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const livePaneIds = new Set(tmux.listPanes(sessionName));
        setPanes(
          (current) =>
            current.map((p) => ({ ...p, _alive: livePaneIds.has(p.paneId) })) as PawPane[],
        );
      } catch {
        // Session may not exist yet
      }
      setSyncState(readSyncState(repoRoot));
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionName, repoRoot, tmux]);

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
    if (key.return && panes[selectedIndex]) {
      try {
        tmux.selectPane(panes[selectedIndex].paneId);
      } catch {
        // Pane may no longer exist
      }
    }
  });

  // Reserve 3 lines for footer (marginTop + hint line)
  const contentHeight = Math.max(terminalHeight - 3, 5);

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box flexDirection="column" height={contentHeight} overflow="hidden">
        <Box marginBottom={1}>
          <Text bold>paw</Text>
          <Text dimColor>{' — ' + sessionName}</Text>
        </Box>

        {panes.length === 0 ? (
          <Text dimColor>No panes. Run `paw launch` to spawn agents.</Text>
        ) : (
          panes.map((pane, i) => {
            const taskState = syncState?.tasks[pane.taskName];
            const mergeEntry = syncState?.merges?.[pane.taskName];
            const status = taskDisplayStatus(taskState, mergeEntry);
            return (
              <PaneCard
                key={pane.id}
                pane={pane}
                status={status}
                selected={i === selectedIndex}
                isFirst={i === 0}
                isLast={i === panes.length - 1}
                isNextSelected={i === selectedIndex - 1}
              />
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>j/k navigate Enter jump q quit</Text>
      </Box>
    </Box>
  );
}
