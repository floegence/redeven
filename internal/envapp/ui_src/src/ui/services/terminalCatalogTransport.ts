import type { TerminalTransport } from '@floegence/floeterm-terminal-web/sessions';

import type { RedevenV1Rpc } from '../protocol/redeven_v1';

// Session catalog metadata is independent from the per-view semantic live
// transport. Browser history, raw replay, and checkpoint APIs deliberately do
// not belong to this adapter.
export function createRedevenTerminalCatalogTransport(rpc: RedevenV1Rpc): TerminalTransport {
  return {
    listSessions: async () => {
      const response = await rpc.terminal.listSessions();
      return Array.isArray(response?.sessions) ? response.sessions : [];
    },
    createSession: async (name, workingDir) => {
      const response = await rpc.terminal.createSession({
        name: name?.trim() || undefined,
        workingDir: workingDir?.trim() || undefined,
      });
      return response.session;
    },
    deleteSession: async (sessionId) => {
      await rpc.terminal.deleteSession({ sessionId });
    },
  };
}
