import type {
  TerminalDataChunk,
  TerminalDataEvent,
  TerminalEventSource,
  TerminalSessionInfo,
  TerminalTransport,
} from '@floegence/floeterm-terminal-web';
import type { RedevenV1Rpc } from '../protocol/redeven_v1';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import { publishTerminalResizeDecision } from './terminalRecoveryDiagnostics';

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

export type RedevenTerminalAttachResult = Readonly<{
  historyBoundarySequence?: number;
  runtimeAttachGeneration?: number;
}>;

export type TerminalHistoryPage = Readonly<{
  chunks: TerminalDataChunk[];
  nextStartSeq: number;
  hasMore: boolean;
  firstSequence: number;
  lastSequence: number;
  coveredThroughSequence?: number;
  snapshotEndSequence?: number;
  firstRetainedSequence?: number;
  historyGeneration?: number;
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

export type RedevenTerminalTransport = TerminalTransport & {
  attachWithHistoryBoundary: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<RedevenTerminalAttachResult>;
  historyPage: (
    sessionId: string,
    startSeq: number,
    endSeq: number,
    options?: TerminalHistoryPageOptions,
  ) => Promise<TerminalHistoryPage>;
  getSessionStats: (sessionId: string) => Promise<TerminalSessionStats>;
  forgetSession: (sessionId: string) => void;
  syncConnectionEpoch: (key: object | null) => void;
  dispose: () => void;
};

const TERMINAL_HISTORY_PAGE_LIMIT_CHUNKS = 2048;
const TERMINAL_HISTORY_PAGE_MAX_BYTES = 512 * 1024;
const TERMINAL_HISTORY_DRAIN_MAX_PAGES = 4096;
const terminalAttachGenerationByScope = new WeakMap<object, number>();

type TerminalResizeDimensions = Readonly<{
  cols: number;
  rows: number;
}>;

type TerminalResizeSender = (sessionId: string, cols: number, rows: number) => Promise<void>;

type TerminalResizeParticipant = Readonly<{
  leaseId: number;
  leaseEpoch: number;
}>;

type TerminalResizeWaiter = TerminalResizeParticipant & Readonly<{
  resolve: () => void;
  reject: (error: unknown) => void;
}>;

type TerminalResizeDesired = Readonly<{
  dimensions: TerminalResizeDimensions;
  sender: TerminalResizeSender;
  sequence: number;
  connectionEpoch: number;
  participant: TerminalResizeParticipant;
  waiters: TerminalResizeWaiter[];
}>;

type TerminalResizeInFlight = {
  dimensions: TerminalResizeDimensions;
  sequence: number;
  connectionEpoch: number;
  participants: TerminalResizeParticipant[];
  waiters: TerminalResizeWaiter[];
};

type TerminalResizeDispatchState = {
  lastSent: Readonly<{
    dimensions: TerminalResizeDimensions;
    sender: TerminalResizeSender;
    sequence: number;
    connectionEpoch: number;
    participant: TerminalResizeParticipant;
  }> | null;
  desiredByLease: Map<number, TerminalResizeDesired>;
  scheduledCancel: (() => void) | null;
  inFlight: TerminalResizeInFlight | null;
  latestAttachGeneration: number;
};

export type TerminalResizeDispatcher = TerminalResizeSender & {
  markSent: (sessionId: string, cols: number, rows: number) => void;
  dispose: () => void;
};

type TerminalResizeEpochToken = Readonly<{
  leaseEpoch: number;
  connectionEpoch: number;
  resizeSequence: number;
  attachGeneration: number;
}>;

type TerminalResizeLeaseState = {
  id: number;
  epoch: number;
  disposed: boolean;
  sender: TerminalResizeSender;
};

type TerminalResizeLease = Readonly<{
  resize: TerminalResizeSender;
  captureEpoch: (attachGeneration?: number) => TerminalResizeEpochToken;
  acknowledgeAttach: (
    sessionId: string,
    cols: number,
    rows: number,
    token: TerminalResizeEpochToken,
  ) => void;
  forgetSession: (sessionId: string) => void;
  syncConnectionEpoch: (key: object | null) => void;
  dispose: () => void;
}>;

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

function scheduleTerminalResizeFrame(callback: () => void): () => void {
  let active = true;
  const run = () => {
    if (!active) return;
    active = false;
    callback();
  };
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(run);
    return () => {
      active = false;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    };
  }
  const handle = setTimeout(run, 0);
  return () => {
    active = false;
    clearTimeout(handle);
  };
}

class SharedTerminalResizeReconciler {
  private readonly states = new Map<string, TerminalResizeDispatchState>();
  private readonly leases = new Map<number, TerminalResizeLeaseState>();
  private nextLeaseId = 0;
  private nextSequence = 0;
  private connectionEpoch = 1;
  private connectionKey: object | null | undefined;

  constructor(private readonly onQuiescent: () => void) {}

  private stateFor(sessionId: string): TerminalResizeDispatchState {
    const existing = this.states.get(sessionId);
    if (existing) return existing;
    const next: TerminalResizeDispatchState = {
      lastSent: null,
      desiredByLease: new Map(),
      scheduledCancel: null,
      inFlight: null,
      latestAttachGeneration: 0,
    };
    this.states.set(sessionId, next);
    return next;
  }

  private participantActive(participant: TerminalResizeParticipant): boolean {
    const lease = this.leases.get(participant.leaseId);
    return Boolean(lease && !lease.disposed && lease.epoch === participant.leaseEpoch);
  }

  private settle(waiters: TerminalResizeWaiter[], error?: unknown): void {
    for (const waiter of waiters) {
      if (!this.participantActive(waiter)) continue;
      if (error === undefined) {
        waiter.resolve();
      } else {
        waiter.reject(error);
      }
    }
  }

  private schedule(sessionId: string, state: TerminalResizeDispatchState): void {
    if (state.scheduledCancel) return;
    state.scheduledCancel = scheduleTerminalResizeFrame(() => {
      state.scheduledCancel = null;
      void this.flush(sessionId, state);
    });
  }

  private pruneDesired(state: TerminalResizeDispatchState): void {
    for (const [leaseId, desired] of state.desiredByLease) {
      if (desired.connectionEpoch === this.connectionEpoch && this.participantActive(desired.participant)) continue;
      state.desiredByLease.delete(leaseId);
      this.settle(desired.waiters);
    }
  }

  private async flush(sessionId: string, state: TerminalResizeDispatchState): Promise<void> {
    if (state.inFlight) return;
    this.pruneDesired(state);
    if (state.desiredByLease.size === 0) {
      this.onQuiescent();
      return;
    }

    let latest: TerminalResizeDesired | null = null;
    const participants: TerminalResizeParticipant[] = [];
    const waiters: TerminalResizeWaiter[] = [];
    for (const desired of state.desiredByLease.values()) {
      if (!latest || desired.sequence > latest.sequence) latest = desired;
      participants.push(desired.participant);
      waiters.push(...desired.waiters);
    }
    state.desiredByLease.clear();
    if (!latest) {
      this.settle(waiters);
      this.onQuiescent();
      return;
    }

    if (
      state.lastSent?.connectionEpoch === this.connectionEpoch
      && sameTerminalResizeDimensions(state.lastSent.dimensions, latest.dimensions)
    ) {
      publishTerminalResizeDecision(sessionId, 'no_op', latest.dimensions.cols, latest.dimensions.rows);
      this.settle(waiters);
      if (state.desiredByLease.size > 0) this.schedule(sessionId, state);
      this.onQuiescent();
      return;
    }

    const inFlight: TerminalResizeInFlight = {
      dimensions: latest.dimensions,
      sequence: latest.sequence,
      connectionEpoch: latest.connectionEpoch,
      participants,
      waiters,
    };
    state.inFlight = inFlight;
    publishTerminalResizeDecision(sessionId, 'requested', latest.dimensions.cols, latest.dimensions.rows);
    try {
      await latest.sender(sessionId, latest.dimensions.cols, latest.dimensions.rows);
      const current = inFlight.connectionEpoch === this.connectionEpoch
        && inFlight.participants.some((participant) => this.participantActive(participant));
      if (current) {
        state.lastSent = {
          dimensions: latest.dimensions,
          sender: latest.sender,
          sequence: latest.sequence,
          connectionEpoch: this.connectionEpoch,
          participant: latest.participant,
        };
        publishTerminalResizeDecision(sessionId, 'applied', latest.dimensions.cols, latest.dimensions.rows);
      }
      this.settle(inFlight.waiters);
    } catch (e) {
      const current = inFlight.connectionEpoch === this.connectionEpoch
        && inFlight.participants.some((participant) => this.participantActive(participant));
      if (current) {
        publishTerminalResizeDecision(sessionId, 'failed', latest.dimensions.cols, latest.dimensions.rows);
        this.settle(inFlight.waiters, e);
      } else {
        this.settle(inFlight.waiters);
      }
    } finally {
      if (state.inFlight === inFlight) state.inFlight = null;
      if (state.desiredByLease.size > 0) this.schedule(sessionId, state);
      this.onQuiescent();
    }
  }

  private queueResize(
    lease: TerminalResizeLeaseState,
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const dimensions = normalizeTerminalResizeDimensions(cols, rows);
    if (!normalizedSessionId || !dimensions || lease.disposed) return Promise.resolve();

    const state = this.stateFor(normalizedSessionId);
    if (
      !state.inFlight
      && state.desiredByLease.size === 0
      && state.lastSent?.connectionEpoch === this.connectionEpoch
      && sameTerminalResizeDimensions(state.lastSent.dimensions, dimensions)
    ) {
      publishTerminalResizeDecision(normalizedSessionId, 'no_op', dimensions.cols, dimensions.rows);
      return Promise.resolve();
    }

    const participant = { leaseId: lease.id, leaseEpoch: lease.epoch };
    const promise = new Promise<void>((resolve, reject) => {
      const existing = state.desiredByLease.get(lease.id);
      state.desiredByLease.set(lease.id, {
        dimensions,
        sender: lease.sender,
        sequence: ++this.nextSequence,
        connectionEpoch: this.connectionEpoch,
        participant,
        waiters: [...(existing?.waiters ?? []), { ...participant, resolve, reject }],
      });
    });
    this.schedule(normalizedSessionId, state);
    return promise;
  }

  private acknowledgeAttach(
    lease: TerminalResizeLeaseState,
    sessionId: string,
    cols: number,
    rows: number,
    token: TerminalResizeEpochToken,
  ): void {
    const normalizedSessionId = String(sessionId ?? '').trim();
    const dimensions = normalizeTerminalResizeDimensions(cols, rows);
    if (
      !normalizedSessionId
      || !dimensions
      || lease.disposed
      || token.leaseEpoch !== lease.epoch
      || token.connectionEpoch !== this.connectionEpoch
    ) return;

    const state = this.stateFor(normalizedSessionId);
    if (token.attachGeneration < state.latestAttachGeneration) return;
    state.latestAttachGeneration = Math.max(state.latestAttachGeneration, token.attachGeneration);
    const completedAfterFence = state.lastSent?.connectionEpoch === this.connectionEpoch
      && state.lastSent.sequence > token.resizeSequence
      && !sameTerminalResizeDimensions(state.lastSent.dimensions, dimensions)
      && this.participantActive(state.lastSent.participant)
      ? state.lastSent
      : null;
    for (const [leaseId, desired] of state.desiredByLease) {
      if (desired.sequence > token.resizeSequence) continue;
      state.desiredByLease.delete(leaseId);
      this.settle(desired.waiters);
    }

    let latestFutureSequence = token.resizeSequence;
    if (state.inFlight && state.inFlight.sequence > token.resizeSequence) {
      latestFutureSequence = state.inFlight.sequence;
    }
    for (const desired of state.desiredByLease.values()) {
      latestFutureSequence = Math.max(latestFutureSequence, desired.sequence);
    }
    if (completedAfterFence && completedAfterFence.sequence > latestFutureSequence) {
      const existing = state.desiredByLease.get(completedAfterFence.participant.leaseId);
      if (!existing || existing.sequence < completedAfterFence.sequence) {
        state.desiredByLease.set(completedAfterFence.participant.leaseId, {
          dimensions: completedAfterFence.dimensions,
          sender: completedAfterFence.sender,
          sequence: completedAfterFence.sequence,
          connectionEpoch: this.connectionEpoch,
          participant: completedAfterFence.participant,
          waiters: [],
        });
      }
    }

    const attachBaseline = {
      dimensions,
      sender: lease.sender,
      sequence: token.resizeSequence,
      connectionEpoch: this.connectionEpoch,
      participant: { leaseId: lease.id, leaseEpoch: lease.epoch },
    };
    const inFlight = state.inFlight;
    if (!inFlight) {
      state.lastSent = attachBaseline;
      if (state.desiredByLease.size > 0) this.schedule(normalizedSessionId, state);
      return;
    }

    const inFlightBeforeAttach = inFlight.sequence <= token.resizeSequence;
    const attachSatisfiesInFlight = sameTerminalResizeDimensions(inFlight.dimensions, dimensions);
    if (inFlightBeforeAttach || attachSatisfiesInFlight) {
      this.settle(inFlight.waiters);
      inFlight.waiters = [];
      inFlight.participants = [];
    }
    if (inFlightBeforeAttach && !attachSatisfiesInFlight) {
      state.lastSent = null;
      if (state.desiredByLease.size === 0) {
        state.desiredByLease.set(lease.id, { ...attachBaseline, waiters: [] });
      }
      return;
    }

    state.lastSent = attachBaseline;
    if (state.desiredByLease.size > 0) this.schedule(normalizedSessionId, state);
  }

  private syncConnectionEpoch(lease: TerminalResizeLeaseState, key: object | null): void {
    if (lease.disposed) return;
    if (this.connectionKey === undefined) {
      this.connectionKey = key;
      return;
    }
    if (this.connectionKey === key) return;
    this.connectionKey = key;
    this.connectionEpoch += 1;
    for (const state of this.states.values()) {
      state.lastSent = null;
      for (const desired of state.desiredByLease.values()) this.settle(desired.waiters);
      state.desiredByLease.clear();
      if (state.inFlight) {
        this.settle(state.inFlight.waiters);
        state.inFlight.waiters = [];
        state.inFlight.participants = [];
      }
      if (state.scheduledCancel && !state.inFlight) {
        state.scheduledCancel();
        state.scheduledCancel = null;
      }
    }
    this.onQuiescent();
  }

  private forgetSession(sessionId: string): void {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;
    const state = this.states.get(normalizedSessionId);
    if (!state) return;
    if (state.scheduledCancel) state.scheduledCancel();
    for (const desired of state.desiredByLease.values()) this.settle(desired.waiters);
    if (state.inFlight) {
      this.settle(state.inFlight.waiters);
      state.inFlight.waiters = [];
      state.inFlight.participants = [];
    }
    this.states.delete(normalizedSessionId);
    this.onQuiescent();
  }

  private releaseLease(lease: TerminalResizeLeaseState): void {
    if (lease.disposed) return;
    lease.disposed = true;
    lease.epoch += 1;
    this.leases.delete(lease.id);
    for (const state of this.states.values()) {
      const desired = state.desiredByLease.get(lease.id);
      if (desired) {
        state.desiredByLease.delete(lease.id);
        for (const waiter of desired.waiters) waiter.resolve();
      }
      if (state.inFlight) {
        const waiters = state.inFlight.waiters.filter((waiter) => {
          if (waiter.leaseId !== lease.id) return true;
          waiter.resolve();
          return false;
        });
        const participants = state.inFlight.participants.filter((participant) => participant.leaseId !== lease.id);
        state.inFlight.waiters = waiters;
        state.inFlight.participants = participants;
      }
      if (state.scheduledCancel && state.desiredByLease.size === 0 && !state.inFlight) {
        state.scheduledCancel();
        state.scheduledCancel = null;
      }
    }
    this.onQuiescent();
  }

  acquire(sender: TerminalResizeSender): TerminalResizeLease {
    const lease: TerminalResizeLeaseState = {
      id: ++this.nextLeaseId,
      epoch: 1,
      disposed: false,
      sender,
    };
    this.leases.set(lease.id, lease);
    return {
      resize: (sessionId, cols, rows) => this.queueResize(lease, sessionId, cols, rows),
      captureEpoch: (attachGeneration = 0) => ({
        leaseEpoch: lease.epoch,
        connectionEpoch: this.connectionEpoch,
        resizeSequence: this.nextSequence,
        attachGeneration,
      }),
      acknowledgeAttach: (sessionId, cols, rows, token) => this.acknowledgeAttach(lease, sessionId, cols, rows, token),
      forgetSession: (sessionId) => this.forgetSession(sessionId),
      syncConnectionEpoch: (key) => this.syncConnectionEpoch(lease, key),
      dispose: () => this.releaseLease(lease),
    };
  }

  hasLeases(): boolean {
    return this.leases.size > 0;
  }

  hasWork(): boolean {
    for (const state of this.states.values()) {
      if (state.inFlight || state.desiredByLease.size > 0 || state.scheduledCancel) return true;
    }
    return false;
  }
}

const terminalResizeReconcilersByScope = new WeakMap<object, Map<string, SharedTerminalResizeReconciler>>();

function acquireSharedTerminalResizeLease(
  scope: object,
  connId: string,
  sender: TerminalResizeSender,
): TerminalResizeLease {
  let byConnection = terminalResizeReconcilersByScope.get(scope);
  if (!byConnection) {
    byConnection = new Map();
    terminalResizeReconcilersByScope.set(scope, byConnection);
  }
  let reconciler = byConnection.get(connId);
  if (!reconciler) {
    const connectionRegistry = byConnection;
    reconciler = new SharedTerminalResizeReconciler(() => {
      if (reconciler?.hasLeases() || reconciler?.hasWork()) return;
      connectionRegistry.delete(connId);
    });
    byConnection.set(connId, reconciler);
  }
  return reconciler.acquire(sender);
}

export function createTerminalResizeDispatcher(sender: TerminalResizeSender): TerminalResizeDispatcher {
  const reconciler = new SharedTerminalResizeReconciler(() => undefined);
  const lease = reconciler.acquire(sender);
  const dispatch: TerminalResizeDispatcher = (sessionId, cols, rows) => lease.resize(sessionId, cols, rows);
  dispatch.markSent = (sessionId, cols, rows) => {
    lease.acknowledgeAttach(sessionId, cols, rows, lease.captureEpoch());
  };
  dispatch.dispose = lease.dispose;
  return dispatch;
}

export function isBestEffortTerminalDisconnectError(e: unknown): boolean {
  if (e instanceof ProtocolNotConnectedError) return true;
  if (e instanceof RpcError && e.code === -1) return true;
  return e instanceof Error && e.name === 'AbortError';
}

export type TerminalAttachLifecycleExit = 'disconnected' | 'session_gone' | 'superseded' | 'connection_closed';

export function classifyTerminalAttachLifecycleExit(e: unknown): TerminalAttachLifecycleExit | null {
  if (isBestEffortTerminalDisconnectError(e)) return 'disconnected';
  if (!(e instanceof RpcError)) return null;
  if (e.code === 404) return 'session_gone';
  if (e.code === 409) return 'superseded';
  if (e.code === 410) return 'connection_closed';
  return null;
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

export function createRedevenTerminalTransport(
  rpc: RedevenV1Rpc,
  connId: string,
  attachGenerationScope: object = rpc,
): RedevenTerminalTransport {
  const ignoreIfNotConnected = (e: unknown) => {
    if (isBestEffortTerminalDisconnectError(e)) return true;
    return false;
  };
  const resizeLease = acquireSharedTerminalResizeLease(attachGenerationScope, connId, async (sessionId, cols, rows) => {
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
    const resp = await rpc.terminal.history({
      sessionId,
      startSeq,
      endSeq: options?.snapshotEndSequence ?? endSeq,
      historyGeneration: options?.historyGeneration,
      limitChunks,
      maxBytes,
    });
    const chunks: TerminalDataChunk[] = Array.isArray(resp?.chunks) ? resp.chunks : [];
    const firstSequence = Number(resp?.firstSequence ?? 0);
    const lastSequence = Number(resp?.lastSequence ?? 0);
    const hasMore = Boolean(resp?.hasMore ?? false);
    const nextStartSeq = Number(resp?.nextStartSeq ?? 0);

    return {
      chunks,
      nextStartSeq,
      hasMore,
      firstSequence,
      lastSequence,
      ...(Object.prototype.hasOwnProperty.call(resp, 'coveredThroughSequence')
        ? { coveredThroughSequence: resp.coveredThroughSequence }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(resp, 'snapshotEndSequence')
        ? { snapshotEndSequence: resp.snapshotEndSequence }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(resp, 'firstRetainedSequence')
        ? { firstRetainedSequence: resp.firstRetainedSequence }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(resp, 'historyGeneration')
        ? { historyGeneration: resp.historyGeneration }
        : {}),
      historyReset: Boolean(resp?.historyReset ?? false),
      historyTruncated: Boolean(resp?.historyTruncated ?? false),
      coveredBytes: Number(resp?.coveredBytes ?? 0),
      totalBytes: Number(resp?.totalBytes ?? 0),
    };
  };

  const attachWithHistoryBoundary = async (
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<RedevenTerminalAttachResult> => {
    const currentAttachGeneration = terminalAttachGenerationByScope.get(attachGenerationScope) ?? 0;
    if (currentAttachGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new Error('terminal attach generation exhausted');
    }
    const attachGeneration = currentAttachGeneration + 1;
    const resizeEpoch = resizeLease.captureEpoch(attachGeneration);
    terminalAttachGenerationByScope.set(attachGenerationScope, attachGeneration);
    const response = await rpc.terminal.attach({ sessionId, connId, cols, rows, attachGeneration });
    if (response?.ok !== true) {
      throw new Error('terminal attach was not acknowledged');
    }
    if (!Object.prototype.hasOwnProperty.call(response, 'historyBoundarySequence')) {
      return { runtimeAttachGeneration: attachGeneration };
    }
    const historyBoundarySequence = response.historyBoundarySequence;
    if (!Number.isSafeInteger(historyBoundarySequence) || (historyBoundarySequence as number) < 0) {
      return { historyBoundarySequence: Number.NaN, runtimeAttachGeneration: attachGeneration };
    }
    resizeLease.acknowledgeAttach(sessionId, cols, rows, resizeEpoch);
    return { historyBoundarySequence, runtimeAttachGeneration: attachGeneration };
  };

  const forgetSession = (sessionId: string) => {
    resizeLease.forgetSession(sessionId);
  };

  return {
    attach: async (sessionId, cols, rows) => {
      await attachWithHistoryBoundary(sessionId, cols, rows);
    },
    attachWithHistoryBoundary,
    resize: async (sessionId, cols, rows) => {
      try {
        await resizeLease.resize(sessionId, cols, rows);
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
        if (!Number.isSafeInteger(page.nextStartSeq) || page.nextStartSeq <= cursor) {
          throw new Error('terminal history pagination returned an invalid cursor');
        }
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
      forgetSession(sessionId);
    },

    getSessionStats: async (sessionId) => {
      const resp = await rpc.terminal.getSessionStats({ sessionId });
      const totalBytes = Number(resp?.history?.totalBytes ?? 0);
      return { history: { totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0 } };
    },
    forgetSession,
    syncConnectionEpoch: resizeLease.syncConnectionEpoch,
    dispose: resizeLease.dispose,
  };
}
