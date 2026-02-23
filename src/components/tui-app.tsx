import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { TmuxServiceApi, PawPane, TmuxPaneInfo } from '../lib/tmux.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { readSyncState } from '../lib/sync.js';
import type { SyncState } from '../lib/sync.js';
import { commandBadge, taskDisplayStatus, statusIcon, SIDEBAR_WIDTH } from '../lib/tui-helpers.js';
import type { TuiStatus } from '../lib/tui-helpers.js';

const LINE_WIDTH = SIDEBAR_WIDTH - 2; // border chars consume 2 columns
const CONTENT_WIDTH = LINE_WIDTH - 2; // inner padding consumes 2 columns

/**
 * A single entry in the TUI display list. Every tmux pane in the session
 * becomes a DisplayItem. Task panes (tracked in panes.json) carry sync
 * state; non-task panes are generic sessions.
 */
export interface DisplayItem {
  paneId: string;
  /** Display label shown in the card. */
  label: string;
  /** Command badge from pane_current_command, e.g. [cc], [bash]. */
  badge: string;
  /** Status icon prefix and color. Null for non-task panes. */
  status: TuiStatus | null;
}

interface PaneCardProps {
  item: DisplayItem;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  isNextSelected: boolean;
}

/**
 * Renders a single pane as a bordered card in the TUI list.
 * Task panes show a status icon; non-task panes show a $ prefix.
 */
function PaneCard({ item, selected, isFirst, isLast, isNextSelected }: PaneCardProps) {
  const borderColor = selected ? 'cyan' : 'gray';
  const bottomBorderColor = selected || isNextSelected ? 'cyan' : 'gray';

  let icon: string;
  let iconColor: string;
  if (item.status) {
    const si = statusIcon(item.status);
    icon = si.icon;
    iconColor = si.color;
  } else {
    icon = '$';
    iconColor = 'green';
  }

  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH}>
      {isFirst && (
        <Box>
          <Text color={borderColor}>╭</Text>
          <Text color={borderColor}>{'─'.repeat(LINE_WIDTH)}</Text>
          <Text color={borderColor}>╮</Text>
        </Box>
      )}
      <Box width={SIDEBAR_WIDTH}>
        <Text color={borderColor}>{'│ '}</Text>
        <Box width={CONTENT_WIDTH} justifyContent="space-between">
          <Box>
            <Text color={iconColor}>{icon + ' '}</Text>
            <Text bold={selected} color={selected ? 'cyan' : 'white'}>
              {item.label.substring(0, 25)}
            </Text>
          </Box>
          <Text color="gray">{item.badge}</Text>
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

/**
 * Derives a human-readable label for a non-task pane from its tmux title.
 * Strips the "paw-" prefix if present (e.g. "paw-orchestrator" -> "orchestrator").
 */
function labelFromTitle(title: string, paneId: string): string {
  if (!title || title === 'bash' || title === 'zsh') return `pane ${paneId}`;
  return title.startsWith('paw-') ? title.slice(4) : title;
}

/**
 * Builds a unified display list from live tmux panes, enriched with
 * panes.json task metadata and sync state. Task panes appear first
 * (in panes.json order), followed by non-task panes sorted by pane ID.
 * The TUI's own pane (controlPaneId) is excluded.
 */
export function buildDisplayItems(
  tmuxPanes: TmuxPaneInfo[],
  taskPanes: PawPane[],
  syncState: SyncState | null,
  controlPaneId: string,
): DisplayItem[] {
  const taskByPaneId = new Map<string, PawPane>();
  for (const p of taskPanes) taskByPaneId.set(p.paneId, p);

  const items: DisplayItem[] = [];
  const seen = new Set<string>();

  // Task panes first, in panes.json order (preserves YAML task ordering).
  for (const pane of taskPanes) {
    const tmuxInfo = tmuxPanes.find((t) => t.paneId === pane.paneId);
    if (!tmuxInfo) continue; // pane no longer alive in tmux
    if (pane.paneId === controlPaneId) continue;
    seen.add(pane.paneId);

    const taskState = syncState?.tasks[pane.taskName];
    const mergeEntry = syncState?.merges?.[pane.taskName];
    items.push({
      paneId: pane.paneId,
      label: pane.taskName,
      badge: commandBadge(tmuxInfo.command),
      status: taskDisplayStatus(taskState, mergeEntry),
    });
  }

  // Non-task panes: everything in tmux not matched above and not the TUI pane.
  for (const tp of tmuxPanes) {
    if (seen.has(tp.paneId) || tp.paneId === controlPaneId) continue;
    items.push({
      paneId: tp.paneId,
      label: labelFromTitle(tp.title, tp.paneId),
      badge: commandBadge(tp.command),
      status: null,
    });
  }

  return items;
}

interface TuiAppProps {
  sessionName: string;
  repoRoot: string;
  tmux: TmuxServiceApi;
  panes: PawPane[];
  /** tmux pane ID of the sidebar pane, used to re-enforce width on terminal resize. */
  controlPaneId: string;
  onQuit: () => void;
}

/**
 * Ink TUI for paw. Renders a fixed-width left panel listing every tmux pane
 * in the session. Task panes show sync state icons; non-task panes show $.
 */
export function TuiApp({
  sessionName,
  repoRoot,
  tmux,
  panes: initialPanes,
  controlPaneId,
  onQuit,
}: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const [items, setItems] = useState<DisplayItem[]>(() => {
    const tmuxPanes = tmux.listPanesDetailed(sessionName);
    const syncState = readSyncState(repoRoot);
    return buildDisplayItems(tmuxPanes, initialPanes, syncState, controlPaneId);
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const tmuxPanes = tmux.listPanesDetailed(sessionName);
        const config = readPaneConfig(repoRoot);
        const syncState = readSyncState(repoRoot);
        setItems(buildDisplayItems(tmuxPanes, config?.panes ?? [], syncState, controlPaneId));
      } catch {
        // Session may not exist yet
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionName, repoRoot, tmux, controlPaneId]);

  // Re-enforce sidebar width after terminal resize — tmux redistributes pane
  // widths proportionally on resize, which drifts the sidebar without this.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const enforce = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          tmux.resizePane(controlPaneId, SIDEBAR_WIDTH);
        } catch {
          // Best-effort — ignore if pane no longer exists
        }
      }, 500);
    };

    process.stdout.on('resize', enforce);
    process.on('SIGWINCH', enforce);

    return () => {
      process.stdout.off('resize', enforce);
      process.off('SIGWINCH', enforce);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [controlPaneId, tmux]);

  const totalItems = items.length;

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
      setSelectedIndex((i) => Math.min(Math.max(0, totalItems - 1), i + 1));
    }
    if (key.return) {
      const item = items[selectedIndex];
      if (item) {
        try {
          tmux.selectPane(item.paneId);
        } catch {
          // Pane may no longer exist
        }
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

        {items.map((item, i) => (
          <PaneCard
            key={item.paneId}
            item={item}
            selected={i === selectedIndex}
            isFirst={i === 0}
            isLast={i === items.length - 1}
            isNextSelected={i === selectedIndex - 1}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>j/k navigate Enter jump q quit</Text>
      </Box>
    </Box>
  );
}
