import type { TmuxServiceApi, TmuxPaneInfo } from '../../src/lib/tmux.js';

export interface MockTmuxOptions {
  capturePaneContent?: (sessionOrPane: string) => string | null;
}

export type MockTmuxService = TmuxServiceApi & {
  calls: Array<{ method: string; args: unknown[] }>;
};

/** Configurable mock TmuxServiceApi for unit tests. */
export function createMockTmux(opts: MockTmuxOptions = {}): MockTmuxService {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  // Track sessions for sessionExists/createSession/killSession
  const sessions = new Set<string>();

  const defaultCapture: (sessionOrPane: string) => string | null =
    opts.capturePaneContent ?? (() => 'Claude Code v1.0\n❯');

  return {
    calls,
    sessionExists(name: string) {
      calls.push({ method: 'sessionExists', args: [name] });
      return sessions.has(name);
    },
    createSession(name: string, cwd: string) {
      calls.push({ method: 'createSession', args: [name, cwd] });
      sessions.add(name);
    },
    killSession(name: string) {
      calls.push({ method: 'killSession', args: [name] });
      sessions.delete(name);
    },
    listPanesDetailed(sessionName: string) {
      calls.push({ method: 'listPanesDetailed', args: [sessionName] });
      return [] as TmuxPaneInfo[];
    },
    sendKeys(paneId: string, keys: string) {
      calls.push({ method: 'sendKeys', args: [paneId, keys] });
    },
    capturePaneContent(sessionOrPane: string, lines?: number) {
      calls.push({ method: 'capturePaneContent', args: [sessionOrPane, lines] });
      return defaultCapture(sessionOrPane);
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
    getCurrentSessionName() {
      calls.push({ method: 'getCurrentSessionName', args: [] });
      return 'fleet-myapp';
    },
    getPaneCurrentCommand(paneId: string): string | null {
      calls.push({ method: 'getPaneCurrentCommand', args: [paneId] });
      return 'bash';
    },
    listSessions() {
      calls.push({ method: 'listSessions', args: [] });
      return [...sessions];
    },
  };
}
