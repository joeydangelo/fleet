import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { basename, dirname } from 'node:path';
import type { TmuxServiceApi, PawPane, TmuxPaneInfo, AgentName } from '../lib/tmux.js';
import { readPaneConfig } from '../lib/pane-state.js';
import { readSyncState } from '../lib/sync.js';
import type { SyncState } from '../lib/sync.js';
import { commandBadge, taskDisplayStatus, statusIcon, SIDEBAR_WIDTH } from '../lib/tui-helpers.js';
import type { TuiStatus } from '../lib/tui-helpers.js';
import { resolveGitRoot } from '../lib/dir-scanner.js';
import { ORCHESTRATOR_ROLE } from '../lib/constants.js';
import { ProjectPicker, AgentPicker } from './project-picker.js';

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
  /** If set, render a project separator header before this item. */
  projectHeader?: string;
}

type OverlayState = 'none' | 'project' | 'agent';

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
      {item.projectHeader && (
        <Box marginTop={isFirst ? 0 : 1}>
          <Text dimColor>
            {'── ' +
              item.projectHeader +
              ' ' +
              '─'.repeat(Math.max(0, LINE_WIDTH - item.projectHeader.length - 4))}
          </Text>
        </Box>
      )}
      {isFirst && !item.projectHeader && (
        <Box>
          <Text color={borderColor}>╭</Text>
          <Text color={borderColor}>{'─'.repeat(LINE_WIDTH)}</Text>
          <Text color={borderColor}>╮</Text>
        </Box>
      )}
      {item.projectHeader && (
        <Box>
          <Text color={borderColor}>╭</Text>
          <Text color={borderColor}>{'─'.repeat(LINE_WIDTH)}</Text>
          <Text color={borderColor}>╮</Text>
        </Box>
      )}
      {isFirst && !item.projectHeader ? null : null}
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
 * Strips the "paw-" prefix if present; falls back to "pane %nn" for shell defaults.
 */
function labelFromTitle(title: string, paneId: string): string {
  if (!title || title === 'bash' || title === 'zsh') return `pane ${paneId}`;
  return title.startsWith('paw-') ? title.slice(4) : title;
}

/**
 * Resolve a pane's project root using the hybrid model:
 * 1. @paw_project metadata (stable, for managed panes)
 * 2. Live cwd resolved to a git root (dynamic, for ad-hoc panes)
 * 3. null if cwd isn't inside any git repo
 */
function resolveProjectForPane(pane: TmuxPaneInfo): string | null {
  if (pane.project) return pane.project;
  if (pane.cwd) return resolveGitRoot(pane.cwd);
  return null;
}

/**
 * Builds a unified display list from live tmux panes, enriched with
 * panes.json task metadata and sync state. Panes are grouped by project
 * when 2+ projects exist.
 */
export function buildDisplayItems(
  tmuxPanes: TmuxPaneInfo[],
  taskPanes: PawPane[],
  syncState: SyncState | null,
  controlPaneId: string,
  orchestratorPaneId: string,
  primaryProject?: string,
): DisplayItem[] {
  const seen = new Set<string>();
  const items: DisplayItem[] = [];

  // Build a flat list of items with their resolved project root.
  type TaggedItem = DisplayItem & { projectRoot: string | null };
  const tagged: TaggedItem[] = [];

  // Orchestrator pane first.
  // Use @paw_project if set, otherwise primaryProject directly — don't fall
  // through to resolveGitRoot(cwd) because the orchestrator's cwd may be
  // inside a worktree whose .git file would resolve to the wrong root.
  if (orchestratorPaneId && orchestratorPaneId !== controlPaneId) {
    const tmuxInfo = tmuxPanes.find((t) => t.paneId === orchestratorPaneId);
    if (tmuxInfo) {
      seen.add(orchestratorPaneId);
      tagged.push({
        paneId: orchestratorPaneId,
        label: 'orchestrator',
        badge: commandBadge(tmuxInfo.command),
        status: null,
        projectRoot: tmuxInfo.project || primaryProject || null,
      });
    }
  }

  // Task panes in panes.json order. These are known to belong to the primary
  // project — use @paw_project or primaryProject, never resolveGitRoot(cwd)
  // which would resolve worktree .git files to the worktree path itself.
  for (const pane of taskPanes) {
    const tmuxInfo = tmuxPanes.find((t) => t.paneId === pane.paneId);
    if (!tmuxInfo) continue;
    if (pane.paneId === controlPaneId || seen.has(pane.paneId)) continue;
    seen.add(pane.paneId);

    const taskState = syncState?.tasks[pane.taskName];
    const mergeEntry = syncState?.merges?.[pane.taskName];
    tagged.push({
      paneId: pane.paneId,
      label: pane.taskName,
      badge: commandBadge(tmuxInfo.command),
      status: taskDisplayStatus(taskState, mergeEntry),
      projectRoot: tmuxInfo.project || primaryProject || null,
    });
  }

  // Ad-hoc panes.
  for (const tp of tmuxPanes) {
    if (seen.has(tp.paneId) || tp.paneId === controlPaneId) continue;
    const isOrchestrator = tp.role === ORCHESTRATOR_ROLE;
    tagged.push({
      paneId: tp.paneId,
      label: isOrchestrator ? 'orchestrator' : labelFromTitle(tp.title, tp.paneId),
      badge: commandBadge(tp.command),
      status: null,
      projectRoot: resolveProjectForPane(tp),
    });
  }

  // Collect unique projects in encounter order.
  const projectOrder: string[] = [];
  const projectSet = new Set<string>();
  for (const t of tagged) {
    const key = t.projectRoot ?? '';
    if (key && !projectSet.has(key)) {
      projectOrder.push(key);
      projectSet.add(key);
    }
  }

  const multipleProjects = projectOrder.length >= 2;

  // Group by project in encounter order; ungrouped (null projectRoot) at the end.
  for (const project of projectOrder) {
    const projectItems = tagged.filter((t) => t.projectRoot === project);
    let isFirstInGroup = true;
    for (const t of projectItems) {
      const item: DisplayItem = {
        paneId: t.paneId,
        label: t.label,
        badge: t.badge,
        status: t.status,
      };
      if (multipleProjects && isFirstInGroup) {
        item.projectHeader = basename(project);
        isFirstInGroup = false;
      }
      items.push(item);
    }
  }

  // Ungrouped panes (no project root).
  const ungrouped = tagged.filter((t) => t.projectRoot === null);
  for (const t of ungrouped) {
    items.push({
      paneId: t.paneId,
      label: t.label,
      badge: t.badge,
      status: t.status,
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
  /** Callback to add a new project to the workspace. */
  addProject?: (projectRoot: string, agent: AgentName) => void;
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
  addProject,
}: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const [items, setItems] = useState<DisplayItem[]>(() => {
    const tmuxPanes = tmux.listPanesDetailed(sessionName);
    const config = readPaneConfig(repoRoot);
    const syncState = readSyncState(repoRoot);
    return buildDisplayItems(
      tmuxPanes,
      initialPanes,
      syncState,
      controlPaneId,
      config?.orchestratorPaneId ?? '',
      repoRoot,
    );
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [overlay, setOverlay] = useState<OverlayState>('none');
  const [pendingProject, setPendingProject] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const tmuxPanes = tmux.listPanesDetailed(sessionName);
        const config = readPaneConfig(repoRoot);
        const syncState = readSyncState(repoRoot);
        setItems(
          buildDisplayItems(
            tmuxPanes,
            config?.panes ?? [],
            syncState,
            controlPaneId,
            config?.orchestratorPaneId ?? '',
            repoRoot,
          ),
        );
      } catch {
        // Session may not exist yet
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionName, repoRoot, tmux, controlPaneId]);

  // Re-enforce sidebar width after terminal resize.
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
    // Overlays handle their own input
    if (overlay !== 'none') return;

    if (input === 'q') {
      onQuit();
      exit();
      return;
    }
    if (input === 'p' && addProject) {
      setOverlay('project');
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

  const handleProjectSelect = (projectRoot: string) => {
    setPendingProject(projectRoot);
    setOverlay('agent');
  };

  const handleAgentSelect = (agent: AgentName) => {
    if (pendingProject && addProject) {
      addProject(pendingProject, agent);
    }
    setPendingProject(null);
    setOverlay('none');
  };

  const handlePickerCancel = () => {
    if (overlay === 'agent') {
      // Go back to project picker
      setOverlay('project');
      return;
    }
    setPendingProject(null);
    setOverlay('none');
  };

  // Reserve 3 lines for footer (marginTop + hint line)
  const contentHeight = Math.max(terminalHeight - 3, 5);

  // Render overlay popups
  if (overlay === 'project') {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box flexDirection="column" height={contentHeight} overflow="hidden">
          <ProjectPicker
            defaultPath={dirname(repoRoot) + '/'}
            onSelect={handleProjectSelect}
            onCancel={handlePickerCancel}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>ESC cancel</Text>
        </Box>
      </Box>
    );
  }

  if (overlay === 'agent') {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box flexDirection="column" height={contentHeight} overflow="hidden">
          <AgentPicker onSelect={handleAgentSelect} onCancel={handlePickerCancel} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>ESC back</Text>
        </Box>
      </Box>
    );
  }

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
            isFirst={i === 0 && !item.projectHeader}
            isLast={i === items.length - 1}
            isNextSelected={i === selectedIndex - 1}
          />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {addProject
            ? 'j/k navigate Enter jump p project q quit'
            : 'j/k navigate Enter jump q quit'}
        </Text>
      </Box>
    </Box>
  );
}
