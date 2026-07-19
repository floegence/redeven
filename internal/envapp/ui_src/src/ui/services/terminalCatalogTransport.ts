import type { TerminalDataChunk, TerminalTransport } from '@floegence/floeterm-terminal-web';
import type {
  PagedTerminalHistoryPage,
  PagedTerminalHistoryRequest,
} from '@floegence/floeterm-terminal-web/history';

import type { RedevenV1Rpc } from '../protocol/redeven_v1';

export type TerminalHistoryPage = Readonly<{
  chunks: TerminalDataChunk[];
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredThroughSequence: number;
  snapshotEndSequence: number;
  firstRetainedSequence: number;
  historyGeneration: number;
  historyReset: boolean;
  historyTruncated: boolean;
  coveredBytes: number;
  totalBytes: number;
}>;

export type TerminalHistoryPageOptions = Readonly<{
  limitChunks?: number;
  maxBytes?: number;
  snapshotEndSequence?: number;
  historyGeneration?: number;
}>;

const TERMINAL_HISTORY_PAGE_LIMIT_CHUNKS = 2048;
const TERMINAL_HISTORY_PAGE_MAX_BYTES = 512 * 1024;
export const TERMINAL_HISTORY_DRAIN_MAX_PAGES = 4096;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = Math.floor(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function toTerminalHistoryPage(response: Awaited<ReturnType<RedevenV1Rpc['terminal']['history']>>): TerminalHistoryPage {
  const chunks: TerminalDataChunk[] = Array.isArray(response?.chunks) ? response.chunks : [];
  return {
    chunks,
    nextStartSeq: Number(response?.nextStartSeq ?? 0),
    hasMore: Boolean(response?.hasMore ?? false),
    firstSequence: Number(response?.firstSequence ?? 0),
    lastSequence: Number(response?.lastSequence ?? 0),
    coveredThroughSequence: Number(response?.coveredThroughSequence ?? response?.lastSequence ?? 0),
    snapshotEndSequence: Number(response?.snapshotEndSequence ?? 0),
    firstRetainedSequence: Number(response?.firstRetainedSequence ?? 0),
    historyGeneration: Number(response?.historyGeneration ?? 0),
    historyReset: Boolean(response?.historyReset ?? false),
    historyTruncated: Boolean(response?.historyTruncated ?? false),
    coveredBytes: Number(response?.coveredBytes ?? 0),
    totalBytes: Number(response?.totalBytes ?? 0),
  };
}

export function createHistoryPageRequester(rpc: RedevenV1Rpc) {
  return async (
    sessionId: string,
    startSeq: number,
    endSeq: number,
    options?: TerminalHistoryPageOptions,
  ): Promise<TerminalHistoryPage> => {
    const snapshotEndSequence = options?.snapshotEndSequence ?? endSeq;
    const response = await rpc.terminal.history({
      sessionId,
      startSeq,
      endSeq: snapshotEndSequence,
      historyGeneration: options?.historyGeneration,
      limitChunks: normalizePositiveInteger(options?.limitChunks, TERMINAL_HISTORY_PAGE_LIMIT_CHUNKS),
      maxBytes: normalizePositiveInteger(options?.maxBytes, TERMINAL_HISTORY_PAGE_MAX_BYTES),
    });
    return toTerminalHistoryPage(response);
  };
}

export function createRedevenPagedHistoryFetcher(
  rpc: RedevenV1Rpc,
  sessionId: string,
): (request: PagedTerminalHistoryRequest) => Promise<PagedTerminalHistoryPage> {
  const requestHistoryPage = createHistoryPageRequester(rpc);
  const normalizedSessionId = String(sessionId ?? '').trim();
  return async (request) => {
    if (request.signal.aborted) throw new DOMException('The history request was cancelled.', 'AbortError');
    const startSequence = typeof request.cursor === 'number' ? request.cursor : request.startSequence;
    const page = await requestHistoryPage(normalizedSessionId, startSequence, request.endSequence ?? -1, {
      historyGeneration: request.historyGeneration,
      snapshotEndSequence: request.endSequence,
      maxBytes: request.maxBytes,
    });
    if (request.signal.aborted) throw new DOMException('The history request was cancelled.', 'AbortError');
    return {
      chunks: page.chunks,
      hasMore: page.hasMore,
      nextCursor: page.hasMore ? page.nextStartSeq : undefined,
      firstAvailableSequence: page.firstSequence > 0 ? page.firstSequence : undefined,
      firstRetainedSequence: page.firstRetainedSequence,
      coveredThroughSequence: page.coveredThroughSequence,
      snapshotEndSequence: page.snapshotEndSequence,
      historyGeneration: page.historyGeneration,
      historyReset: page.historyReset,
      historyTruncated: page.historyTruncated,
      coveredBytes: page.coveredBytes,
      totalBytes: page.totalBytes,
    };
  };
}

export function createRedevenTerminalCatalogTransport(rpc: RedevenV1Rpc): TerminalTransport {
  const unsupported = (operation: string): never => {
    throw new Error(`Terminal catalog transport does not support ${operation}`);
  };
  return {
    attach: async () => unsupported('attach'),
    resize: async () => unsupported('resize'),
    sendInput: async () => unsupported('sendInput'),
    history: async () => unsupported('history'),
    clear: async () => unsupported('clear'),
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
