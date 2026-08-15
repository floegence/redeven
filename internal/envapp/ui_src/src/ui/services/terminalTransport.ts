import {
  validateHistoryChunk,
  type SemanticHistoryChunk,
  type SemanticHistoryChunkRequest,
} from '@floegence/floeterm-terminal-web/semantic';
import {
  createSemanticTerminalLiveTransport,
  TerminalLiveErrorCode,
  TerminalLiveServerError,
  type SemanticTerminalLiveEventSource,
  type SemanticTerminalLiveTransport,
  type TerminalSemanticClearResult,
} from '@floegence/floeterm-terminal-web/live';
import type { Session } from '@floegence/flowersec-core';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import type { TerminalNameUpdateEvent } from '../protocol/redeven_v1/sdk/terminal';

export function createTerminalConnId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `web_${(crypto as Crypto).randomUUID()}`
    : `web_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export type RedevenTerminalTransport = SemanticTerminalLiveTransport;
export type RedevenTerminalEventSource = Omit<
  SemanticTerminalLiveEventSource,
  'onTerminalNameUpdate'
> & Readonly<{
  onTerminalNameUpdate?: (
    sessionId: string,
    handler: (event: TerminalNameUpdateEvent) => void,
  ) => () => void;
}>;

export type RedevenTerminalLiveBundle = Readonly<{
  transport: RedevenTerminalTransport;
  eventSource: RedevenTerminalEventSource;
}>;

export function isBestEffortTerminalDisconnectError(error: unknown): boolean {
  if (error instanceof ProtocolNotConnectedError) return true;
  if (error instanceof RpcError && error.code === -1) return true;
  return error instanceof Error && error.name === 'AbortError';
}

export type TerminalAttachLifecycleExit = 'disconnected' | 'session_gone';

export function classifyTerminalAttachLifecycleExit(error: unknown): TerminalAttachLifecycleExit | null {
  if (isBestEffortTerminalDisconnectError(error)) return 'disconnected';
  if (error instanceof TerminalLiveServerError && error.code === TerminalLiveErrorCode.SessionNotFound) {
    return 'session_gone';
  }
  if (error instanceof RpcError && error.code === 404) return 'session_gone';
  return null;
}

export function createRedevenTerminalLiveBundle(
  rpc: RedevenV1Rpc,
  client: () => Session | null | undefined,
  connectionId: string,
): RedevenTerminalLiveBundle {
  const live = createSemanticTerminalLiveTransport({
    connectionId,
    openStream: async (kind, options) => {
      const current = client();
      if (!current) throw new ProtocolNotConnectedError();
      const stream = await current.openStream(kind, options);
      return {
        read: () => stream.read(),
        write: async (data: Uint8Array) => { await stream.write(data); },
        close: () => stream.close(),
        reset: () => stream.reset(),
      };
    },
    control: {
      semanticHistory: async (
        sessionId: string,
        currentConnectionId: string,
        transportGeneration: number,
        request: SemanticHistoryChunkRequest,
      ): Promise<SemanticHistoryChunk> => validateHistoryChunk(await rpc.terminal.semanticHistory({
        sessionId,
        connectionId: currentConnectionId,
        transportGeneration,
        ...request,
      })),
      clearSemanticContent: async (
        sessionId: string,
        currentConnectionId: string,
        transportGeneration: number,
      ): Promise<TerminalSemanticClearResult> => await rpc.terminal.semanticClear({
        sessionId,
        connectionId: currentConnectionId,
        transportGeneration,
      }),
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
    },
    controlEvents: {
      onTerminalNameUpdate: (sessionId, handler) => rpc.terminal.onNameUpdate((event) => {
        if (event.sessionId === sessionId) handler(event);
      }),
      onTerminalForegroundCommandUpdate: (sessionId, handler) => rpc.terminal.onForegroundCommandUpdate((event) => {
        if (event.sessionId === sessionId) handler(event);
      }),
      onTerminalOutputActivityUpdate: (sessionId, handler) => rpc.terminal.onOutputActivityUpdate((event) => {
        if (event.sessionId === sessionId) handler(event);
      }),
      onTerminalExecutionContextUpdate: (sessionId, handler) => rpc.terminal.onExecutionContextUpdate((event) => {
        if (event.sessionId === sessionId) handler(event);
      }),
      onTerminalWorkStateUpdate: (sessionId, handler) => rpc.terminal.onWorkStateUpdate((event) => {
        if (event.sessionId === sessionId) handler(event);
      }),
    },
  });

  return {
    transport: live.transport,
    eventSource: live.eventSource as RedevenTerminalEventSource,
  };
}
