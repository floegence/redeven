import type {
  TerminalDataChunk,
  TerminalDataEvent,
  TerminalEventSource,
  TerminalSessionInfo,
  TerminalTransport,
} from '@floegence/floeterm-terminal-web';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';

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

export type TerminalHistoryPage = Readonly<{
  chunks: TerminalDataChunk[];
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredBytes: number;
  totalBytes: number;
}>;

export type TerminalHistoryPageOptions = Readonly<{
  limitChunks?: number;
  maxBytes?: number;
}>;

export type RedevenTerminalTransport = TerminalTransport & {
  historyPage: (
    sessionId: string,
    startSeq: number,
    endSeq: number,
    options?: TerminalHistoryPageOptions,
  ) => Promise<TerminalHistoryPage>;
  getSessionStats: (sessionId: string) => Promise<TerminalSessionStats>;
};

const TERMINAL_HISTORY_PAGE_LIMIT_CHUNKS = 256;
const TERMINAL_HISTORY_PAGE_MAX_BYTES = 384 * 1024;
const TERMINAL_HISTORY_DRAIN_MAX_PAGES = 4096;

type TerminalResizeDimensions = Readonly<{
  cols: number;
  rows: number;
}>;

type TerminalResizeWaiter = Readonly<{
  resolve: () => void;
  reject: (error: unknown) => void;
}>;

type TerminalResizeDispatchState = {
  lastSent: TerminalResizeDimensions | null;
  pending: TerminalResizeDimensions | null;
  waiters: TerminalResizeWaiter[];
  scheduled: boolean;
  inFlight: boolean;
};

type TerminalResizeSender = (sessionId: string, cols: number, rows: number) => Promise<void>;

function normalizeTerminalResizeDimensions(cols: number, rows: number): TerminalResizeDimensions | null {
  const normalizedCols = Math.floor(Number(cols));
  const normalizedRows = Math.floor(Number(rows));
  if (!Number.isFinite(normalizedCols) || !Number.isFinite(normalizedRows)) return null;
  if (normalizedCols <= 0 || normalizedRows <= 0) return null;
  return { cols: normalizedCols, rows: normalizedRows };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function sameTerminalResizeDimensions(
  left: TerminalResizeDimensions | null,
  right: TerminalResizeDimensions | null,
): boolean {
  return Boolean(left && right && left.cols === right.cols && left.rows === right.rows);
}

function scheduleTerminalResizeFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

export function createTerminalResizeDispatcher(sender: TerminalResizeSender): TerminalResizeSender {
  const states = new Map<string, TerminalResizeDispatchState>();

  const stateFor = (sessionId: string): TerminalResizeDispatchState => {
    const existing = states.get(sessionId);
    if (existing) return existing;
    const next: TerminalResizeDispatchState = {
      lastSent: null,
      pending: null,
      waiters: [],
      scheduled: false,
      inFlight: false,
    };
    states.set(sessionId, next);
    return next;
  };

  const settle = (waiters: TerminalResizeWaiter[], error?: unknown) => {
    for (const waiter of waiters) {
      if (error === undefined) {
        waiter.resolve();
      } else {
        waiter.reject(error);
      }
    }
  };

  function schedule(sessionId: string, state: TerminalResizeDispatchState): void {
    if (state.scheduled) return;
    state.scheduled = true;
    scheduleTerminalResizeFrame(() => {
      state.scheduled = false;
      void flush(sessionId, state);
    });
  }

  async function flush(sessionId: string, state: TerminalResizeDispatchState): Promise<void> {
    if (state.inFlight) return;
    const pending = state.pending;
    if (!pending) return;

    const waiters = state.waiters.splice(0);
    state.pending = null;

    if (sameTerminalResizeDimensions(state.lastSent, pending)) {
      settle(waiters);
      if (state.pending) schedule(sessionId, state);
      return;
    }

    state.inFlight = true;
    try {
      await sender(sessionId, pending.cols, pending.rows);
      state.lastSent = pending;
      settle(waiters);
    } catch (e) {
      settle(waiters, e);
    } finally {
      state.inFlight = false;
      if (state.pending) schedule(sessionId, state);
    }
  }

  return (sessionId, cols, rows) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const dimensions = normalizeTerminalResizeDimensions(cols, rows);
    if (!normalizedSessionId || !dimensions) return Promise.resolve();

    const state = stateFor(normalizedSessionId);
    if (!state.pending && !state.inFlight && sameTerminalResizeDimensions(state.lastSent, dimensions)) {
      return Promise.resolve();
    }

    state.pending = dimensions;
    const promise = new Promise<void>((resolve, reject) => {
      state.waiters.push({ resolve, reject });
    });
    schedule(normalizedSessionId, state);
    return promise;
  };
}

function terminalTransportErrorText(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) {
    const causeText = terminalTransportErrorText(e.cause);
    return `${e.name} ${e.message} ${causeText}`.toLowerCase();
  }
  try {
    return JSON.stringify(e).toLowerCase();
  } catch {
    return String(e).toLowerCase();
  }
}

export function isBestEffortTerminalDisconnectError(e: unknown): boolean {
  if (e instanceof ProtocolNotConnectedError) return true;
  if (e instanceof RpcError && e.code === -1) {
    const text = terminalTransportErrorText(e);
    return text.includes('rpc client closed')
      || text.includes('rpc closed')
      || text.includes('websocket closed')
      || text.includes('transport error');
  }
  return false;
}

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
    if (isBestEffortTerminalDisconnectError(e)) return true;
    return false;
  };
  const dispatchResize = createTerminalResizeDispatcher(async (sessionId, cols, rows) => {
    await rpc.terminal.resize({ sessionId, connId, cols, rows });
  });

  const requestHistoryPage = async (
    sessionId: string,
    startSeq: number,
    endSeq: number,
    options?: TerminalHistoryPageOptions,
  ): Promise<TerminalHistoryPage> => {
    const limitChunks = normalizePositiveInteger(options?.limitChunks, TERMINAL_HISTORY_PAGE_LIMIT_CHUNKS);
    const maxBytes = normalizePositiveInteger(options?.maxBytes, TERMINAL_HISTORY_PAGE_MAX_BYTES);
    const resp = await rpc.terminal.history({ sessionId, startSeq, endSeq, limitChunks, maxBytes });
    const chunks: TerminalDataChunk[] = Array.isArray(resp?.chunks) ? resp.chunks : [];
    const firstSequence = Number(resp?.firstSequence ?? 0);
    const lastSequence = Number(resp?.lastSequence ?? 0);
    const hasMore = Boolean(resp?.hasMore ?? false);
    const fallbackNextStartSeq = lastSequence > 0
      ? lastSequence + 1
      : (chunks[chunks.length - 1]?.sequence ?? 0) + 1;
    const nextStartSeq = Number(resp?.nextStartSeq ?? 0);
    const normalizedNextStartSeq = Number.isFinite(nextStartSeq) && nextStartSeq > startSeq
      ? nextStartSeq
      : fallbackNextStartSeq;

    return {
      chunks,
      nextStartSeq: normalizedNextStartSeq,
      hasMore: hasMore && normalizedNextStartSeq > startSeq,
      firstSequence,
      lastSequence,
      coveredBytes: Number(resp?.coveredBytes ?? 0),
      totalBytes: Number(resp?.totalBytes ?? 0),
    };
  };

  return {
    attach: async (sessionId, cols, rows) => {
      await rpc.terminal.attach({ sessionId, connId, cols, rows });
    },
    resize: async (sessionId, cols, rows) => {
      try {
        await dispatchResize(sessionId, cols, rows);
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
    historyPage: requestHistoryPage,
    history: async (sessionId, startSeq, endSeq) => {
      const chunks: TerminalDataChunk[] = [];
      let cursor = startSeq;

      for (let pageCount = 0; pageCount < TERMINAL_HISTORY_DRAIN_MAX_PAGES; pageCount += 1) {
        const page = await requestHistoryPage(sessionId, cursor, endSeq);
        chunks.push(...page.chunks);
        if (!page.hasMore) return chunks;
        if (endSeq > 0 && page.nextStartSeq > endSeq) return chunks;
        cursor = page.nextStartSeq;
      }

      throw new Error('terminal history pagination did not converge');
    },
    clear: async (sessionId) => {
      await rpc.terminal.clear({ sessionId });
    },

    listSessions: async () => {
      const resp = await rpc.terminal.listSessions();
      const sessions: TerminalSessionInfo[] = Array.isArray(resp?.sessions) ? resp.sessions : [];
      return sessions;
    },
    createSession: async (name, workingDir) => {
      const resp = await rpc.terminal.createSession({
        name: name?.trim() ? name.trim() : undefined,
        workingDir: workingDir?.trim() ? workingDir.trim() : undefined,
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
