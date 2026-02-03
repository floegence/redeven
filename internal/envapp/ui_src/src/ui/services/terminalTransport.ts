import type {
  TerminalDataChunk,
  TerminalDataEvent,
  TerminalEventSource,
  TerminalSessionInfo,
  TerminalTransport,
} from '@floegence/floeterm-terminal-web';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { ProtocolNotConnectedError } from '@floegence/floe-webapp-protocol';

export function getOrCreateTerminalConnId(storageKey = 'redeven_terminal_conn_id'): string {
  const existing = sessionStorage.getItem(storageKey);
  if (existing && existing.trim()) return existing.trim();

  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `web_${(crypto as Crypto).randomUUID()}`
    : `web_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;

  sessionStorage.setItem(storageKey, id);
  return id;
}

export type TerminalSessionStats = { history: { totalBytes: number } };

export type RedevenTerminalTransport = TerminalTransport & {
  getSessionStats: (sessionId: string) => Promise<TerminalSessionStats>;
};

export function createRedevenTerminalEventSource(rpc: RedevenV1Rpc): TerminalEventSource {
  return {
    onTerminalData: (sessionId, handler) => (
      rpc.terminal.onOutput((ev) => {
        if (ev.sessionId !== sessionId) return;
        const event: TerminalDataEvent = {
          sessionId,
          data: ev.data,
          sequence: ev.sequence,
          timestampMs: ev.timestampMs,
          echoOfInput: ev.echoOfInput,
          originalSource: ev.originalSource,
        };
        handler(event);
      })
    ),

    onTerminalNameUpdate: (sessionId, handler) => (
      rpc.terminal.onNameUpdate((ev) => {
        if (ev.sessionId !== sessionId) return;
        handler({
          sessionId,
          newName: ev.newName,
          workingDir: ev.workingDir,
        });
      })
    ),
  };
}

export function createRedevenTerminalTransport(rpc: RedevenV1Rpc, connId: string): RedevenTerminalTransport {
  const ignoreIfNotConnected = (e: unknown) => {
    if (e instanceof ProtocolNotConnectedError) return true;
    return false;
  };

  return {
    attach: async (sessionId, cols, rows) => {
      await rpc.terminal.attach({ sessionId, connId, cols, rows });
    },
    resize: async (sessionId, cols, rows) => {
      try {
        await rpc.terminal.resize({ sessionId, connId, cols, rows });
      } catch (e) {
        if (ignoreIfNotConnected(e)) return;
        throw e;
      }
    },
    sendInput: async (sessionId, input, sourceConnId) => {
      const text = String(input ?? '');
      if (!text) return;

      try {
        await rpc.terminal.sendTextInput({
          sessionId,
          connId: String(sourceConnId ?? connId),
          text,
        });
      } catch (e) {
        if (ignoreIfNotConnected(e)) return;
        throw e;
      }
    },
    history: async (sessionId, startSeq, endSeq) => {
      const resp = await rpc.terminal.history({ sessionId, startSeq, endSeq });
      const chunks: TerminalDataChunk[] = Array.isArray(resp?.chunks) ? resp.chunks : [];
      return chunks;
    },
    clear: async (sessionId) => {
      await rpc.terminal.clear({ sessionId });
    },

    listSessions: async () => {
      const resp = await rpc.terminal.listSessions();
      const sessions: TerminalSessionInfo[] = Array.isArray(resp?.sessions) ? resp.sessions : [];
      return sessions;
    },
    createSession: async (name, workingDir, cols, rows) => {
      const resp = await rpc.terminal.createSession({
        name: name?.trim() ? name.trim() : undefined,
        workingDir: workingDir?.trim() ? workingDir.trim() : undefined,
        cols: typeof cols === 'number' ? cols : 80,
        rows: typeof rows === 'number' ? rows : 24,
      });
      return resp.session;
    },

    deleteSession: async (sessionId) => {
      await rpc.terminal.deleteSession({ sessionId });
    },

    getSessionStats: async (sessionId) => {
      const resp = await rpc.terminal.getSessionStats({ sessionId });
      const totalBytes = Number(resp?.history?.totalBytes ?? 0);
      return { history: { totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0 } };
    },
  };
}

