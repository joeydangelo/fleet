import type { TmuxServiceApi, TmuxPaneInfo } from '../../src/lib/tmux.js';

export interface MockTmuxOptions {
  existingPanes?: string[];
  titleMap?: Map<string, string>;
  /** When true, sessionExists tracks creates/deletes. When false, always returns true. */
  sessionExistsDefault?: boolean;
  capturePaneContent?: (sessionOrPane: string) => string | null;
}

export type MockTmuxService = TmuxServiceApi & {
  calls: Array<{ method: string; args: unknown[] }>;
};

/** Configurable mock TmuxServiceApi for unit tests. */
export function createMockTmux(opts: MockTmuxOptions = {}): MockTmuxService {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let paneCounter = 100;
  const existingPanes = opts.existingPanes ?? [];
  const titleMap = opts.titleMap ?? new Map<string, string>();

  // Tracked-Set mode: sessionExists tracks creates/deletes (tmux.test style).
  // Pane-state mode: sessionExists always returns true (pane-state.test style).
  // Detect by whether existingPanes was explicitly provided in opts.
  const panesExplicit = 'existingPanes' in opts;
  const useTrackedSessions = opts.sessionExistsDefault === undefined && !panesExplicit;
  const sessions = new Set<string>();
  const defaultSessionExists = opts.sessionExistsDefault ?? true;

  const defaultCapture: (sessionOrPane: string) => string | null =
    opts.capturePaneContent ?? (useTrackedSessions ? () => 'Claude Code v1.0\n❯' : () => null);

  return {
    calls,
    selectPane(paneId: string) {
      calls.push({ method: 'selectPane', args: [paneId] });
    },
    sessionExists(name: string) {
      calls.push({ method: 'sessionExists', args: [name] });
      return useTrackedSessions ? sessions.has(name) : defaultSessionExists;
    },
    createSession(name: string, cwd: string) {
      calls.push({ method: 'createSession', args: [name, cwd] });
      sessions.add(name);
    },
    killSession(name: string) {
      calls.push({ method: 'killSession', args: [name] });
      sessions.delete(name);
    },
    createPane(sessionName: string, cwd: string, opts?: { horizontal?: boolean }) {
      calls.push({ method: 'createPane', args: [sessionName, cwd, opts] });
      paneCounter++;
      return `%${paneCounter}`;
    },
    killPane(paneId: string) {
      calls.push({ method: 'killPane', args: [paneId] });
    },
    listPanes(sessionName: string) {
      calls.push({ method: 'listPanes', args: [sessionName] });
      return existingPanes;
    },
    listPanesDetailed(sessionName: string) {
      calls.push({ method: 'listPanesDetailed', args: [sessionName] });
      return [] as TmuxPaneInfo[];
    },
    listPanesWithTitles(sessionName: string) {
      calls.push({ method: 'listPanesWithTitles', args: [sessionName] });
      return titleMap;
    },
    paneExists(paneId: string) {
      calls.push({ method: 'paneExists', args: [paneId] });
      return panesExplicit ? existingPanes.includes(paneId) : true;
    },
    sendKeys(paneId: string, keys: string) {
      calls.push({ method: 'sendKeys', args: [paneId, keys] });
    },
    capturePane(paneId: string, lines?: number) {
      calls.push({ method: 'capturePane', args: [paneId, lines] });
      return '';
    },
    capturePaneContent(sessionOrPane: string, lines?: number) {
      calls.push({ method: 'capturePaneContent', args: [sessionOrPane, lines] });
      return defaultCapture(sessionOrPane);
    },
    selectLayout(sessionName: string, layout: string) {
      calls.push({ method: 'selectLayout', args: [sessionName, layout] });
    },
    setPaneTitle(paneId: string, title: string) {
      calls.push({ method: 'setPaneTitle', args: [paneId, title] });
    },
    setPaneRole(paneId: string, role: string) {
      calls.push({ method: 'setPaneRole', args: [paneId, role] });
    },
    setPaneProject(paneId: string, projectRoot: string) {
      calls.push({ method: 'setPaneProject', args: [paneId, projectRoot] });
    },
    listClients() {
      calls.push({ method: 'listClients', args: [] });
      return [];
    },
    hasAttachedClient(sessionName: string) {
      calls.push({ method: 'hasAttachedClient', args: [sessionName] });
      return false;
    },
    getCurrentPaneId() {
      calls.push({ method: 'getCurrentPaneId', args: [] });
      return '%0';
    },
    getCurrentSessionName() {
      calls.push({ method: 'getCurrentSessionName', args: [] });
      return 'fleet-myapp';
    },
    getPaneCurrentCommand(paneId: string) {
      calls.push({ method: 'getPaneCurrentCommand', args: [paneId] });
      return 'bash';
    },
    resizePane(paneId: string, width: number) {
      calls.push({ method: 'resizePane', args: [paneId, width] });
    },
    pinSidebarLayout(sessionName: string, width: number) {
      calls.push({ method: 'pinSidebarLayout', args: [sessionName, width] });
    },
    switchClient(sessionName: string) {
      calls.push({ method: 'switchClient', args: [sessionName] });
    },
    attachSession(sessionName: string) {
      calls.push({ method: 'attachSession', args: [sessionName] });
    },
    listSessions() {
      calls.push({ method: 'listSessions', args: [] });
      return [...sessions];
    },
  };
}
