import type {
  TerminalDataChunk,
  TerminalEventSource,
  TerminalTransport,
} from '@floegence/floeterm-terminal-web';
import {
  createTerminalLiveTransport,
  TerminalLiveErrorCode,
  TerminalLiveServerError,
  type TerminalLiveAttachResult,
} from '@floegence/floeterm-terminal-web/live';
import type { Client } from '@floegence/flowersec-core';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import {
  TERMINAL_HISTORY_DRAIN_MAX_PAGES,
  createHistoryPageRequester,
  type TerminalHistoryPage,
  type TerminalHistoryPageOptions,
} from './terminalCatalogTransport';

export function createTerminalConnId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `web_${(crypto as Crypto).randomUUID()}`
    : `web_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export type TerminalSessionStats = { history: { totalBytes: number } };
export type RedevenTerminalAttachResult = TerminalLiveAttachResult;

export type RedevenTerminalTransport = TerminalTransport & Readonly<{
  attachWithHistoryBoundary(sessionId: string, cols: number, rows: number): Promise<RedevenTerminalAttachResult>;
  historyPage(
    sessionId: string,
    startSeq: number,
    endSeq: number,
    options?: TerminalHistoryPageOptions,
  ): Promise<TerminalHistoryPage>;
  getSessionStats(sessionId: string): Promise<TerminalSessionStats>;
  forgetSession(sessionId: string): void;
  syncConnectionEpoch(key: object | null): void;
  dispose(): void;
}>;

export type RedevenTerminalLiveBundle = Readonly<{
  transport: RedevenTerminalTransport;
  eventSource: TerminalEventSource;
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
  client: () => Client | null | undefined,
  connectionId: string,
): RedevenTerminalLiveBundle {
  const requestHistoryPage = createHistoryPageRequester(rpc);
  const controlEvents: TerminalEventSource = {
    onTerminalData: () => {
      throw new Error('terminal data is available only through terminal/live_v1');
    },
    onTerminalNameUpdate: (sessionId, handler) => rpc.terminal.onNameUpdate((event) => {
      if (event.sessionId !== sessionId) return;
      handler({ sessionId, newName: event.newName, workingDir: event.workingDir });
    }),
    onTerminalForegroundCommandUpdate: (sessionId, handler) => rpc.terminal.onForegroundCommandUpdate((event) => {
      if (event.sessionId !== sessionId) return;
      handler({ sessionId, foregroundCommand: event.foregroundCommand });
    }),
  };
  const live = createTerminalLiveTransport({
    connectionId,
    openStream: async (kind, options) => {
      const current = client();
      if (!current) throw new ProtocolNotConnectedError();
      return current.openStream(kind, options);
    },
    control: {
      history: async (sessionId, startSeq, endSeq) => {
        const chunks: TerminalDataChunk[] = [];
        let cursor = startSeq;
        for (let pageIndex = 0; pageIndex < TERMINAL_HISTORY_DRAIN_MAX_PAGES; pageIndex += 1) {
          const page = await requestHistoryPage(sessionId, cursor, endSeq);
          chunks.push(...page.chunks);
          if (!page.hasMore) return chunks;
          if (!Number.isSafeInteger(page.nextStartSeq) || page.nextStartSeq <= cursor) {
            throw new Error('terminal history pagination returned an invalid cursor');
          }
          cursor = page.nextStartSeq;
        }
        throw new Error('terminal history pagination did not converge');
      },
      historyPage: async (sessionId, startSequence, endSequence, historyGeneration) => {
        const page = await requestHistoryPage(sessionId, startSequence, endSequence, {
          snapshotEndSequence: endSequence,
          historyGeneration,
        });
        return {
          chunks: page.chunks,
          firstRetainedSequence: page.firstRetainedSequence,
          nextStartSequence: page.nextStartSeq,
          hasMore: page.hasMore,
          coveredThroughSequence: page.coveredThroughSequence,
          snapshotEndSequence: page.snapshotEndSequence,
          historyGeneration: page.historyGeneration,
          historyReset: page.historyReset,
          historyTruncated: page.historyTruncated,
          totalBytes: page.totalBytes,
        };
      },
      clear: async (sessionId) => {
        await rpc.terminal.clear({ sessionId });
      },
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
    controlEvents,
  });

  const transport: RedevenTerminalTransport = {
    ...live.transport,
    attachWithHistoryBoundary: async (sessionId, cols, rows) => live.transport.attachWithHistoryBoundary(sessionId, cols, rows),
    historyPage: requestHistoryPage,
    getSessionStats: async (sessionId) => {
      const response = await rpc.terminal.getSessionStats({ sessionId });
      const totalBytes = Number(response?.history?.totalBytes ?? 0);
      return { history: { totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0 } };
    },
  };
  return { transport, eventSource: live.eventSource };
}
