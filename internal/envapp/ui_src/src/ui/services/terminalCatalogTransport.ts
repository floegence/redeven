import type {
  TerminalSessionInfo as FloetermTerminalSessionInfo,
  TerminalTransport,
} from '@floegence/floeterm-terminal-web/sessions';

import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import type { TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';

export type TerminalCatalogListFence = Readonly<{
  requestSequence: number;
  membershipRevision: number;
  lifecycleRevision: number;
}>;

export type TerminalCatalogTransportOptions = Readonly<{
  beginListSessions?: () => TerminalCatalogListFence;
  onSessionsListed?: (
    sessions: readonly TerminalSessionInfo[],
    fence: TerminalCatalogListFence | null,
  ) => void;
  onSessionCreated?: (session: TerminalSessionInfo) => void;
}>;

function runtimeSession(session: TerminalSessionInfo): FloetermTerminalSessionInfo {
  const { groupId: _groupId, ...runtime } = session;
  return runtime;
}

// Session catalog metadata is independent from the per-view semantic live
// attachment, which owns presentation, history, and terminal controls.
export function createRedevenTerminalCatalogTransport(
  rpc: RedevenV1Rpc,
  options: TerminalCatalogTransportOptions = {},
): TerminalTransport {
  return {
    listSessions: async () => {
      const fence = options.beginListSessions?.() ?? null;
      const response = await rpc.terminal.listSessions();
      const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
      options.onSessionsListed?.(sessions, fence);
      return sessions.map(runtimeSession);
    },
    createSession: async (name, workingDir) => {
      const response = await rpc.terminal.createSession({
        name: name?.trim() || undefined,
        workingDir: workingDir?.trim() || undefined,
      });
      options.onSessionCreated?.(response.session);
      return runtimeSession(response.session);
    },
    deleteSession: async (sessionId) => {
      await rpc.terminal.deleteSession({ sessionId });
    },
  };
}
