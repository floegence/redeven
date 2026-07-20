import { createContext, createEffect, createSignal, onCleanup, untrack, useContext, type Accessor, type ParentProps } from 'solid-js';
import type {
  TerminalForegroundCommandInfo,
  TerminalSessionInfo,
  TerminalSessionsCoordinator,
} from '@floegence/floeterm-terminal-web/sessions';
import type { PreparedPagedTerminalHistory } from '@floegence/floeterm-terminal-web/history';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { useEnvContext } from '../pages/EnvContext';
import { canLaunchProcess, isPermissionDeniedError } from '../utils/permission';
import {
  createRedevenPagedHistoryFetcher,
  createRedevenTerminalCatalogTransport,
} from './terminalCatalogTransport';
import { createRedevenTerminalSessionsCoordinator } from './terminalSessions';
import { scheduleTerminalFeaturePreload } from './terminalFeaturePreload';
import {
  createTerminalHistoryWarmup,
  type TerminalHistoryWarmup,
  type TerminalHistoryWarmupEvent,
} from './terminalHistoryWarmup';
import { resolveTerminalWarmBudgetBytes } from './terminalAdaptiveWorkingSet';
import { TerminalSessionsLifecycleSync } from './terminalSessionsLifecycleSync';
import { publishDebugConsoleStructuredEvent } from './debugConsoleCapture';
import {
  markTerminalPerformance,
  pseudonymousTerminalSessionRef,
  type TerminalPerformanceStage,
} from './terminalPerformance';

export type TerminalSessionCatalogValue = Readonly<{
  sessions: Accessor<readonly TerminalSessionInfo[]>;
  hydrated: Accessor<boolean>;
  loading: Accessor<boolean>;
  stale: Accessor<boolean>;
  error: Accessor<string | null>;
  permissionDenied: Accessor<boolean>;
  connectionEpoch: Accessor<number>;
  coordinator: Accessor<TerminalSessionsCoordinator | null>;
  getCoordinator: () => TerminalSessionsCoordinator | null;
  refresh: () => Promise<void>;
  upsertSession: (session: TerminalSessionInfo) => void;
  removeSession: (sessionId: string) => void;
  updateSessionMeta: (sessionId: string, patch: {
    name?: string;
    workingDir?: string;
    lastActiveAtMs?: number;
    isActive?: boolean;
    foregroundCommand?: TerminalForegroundCommandInfo;
  }) => void;
  clearForPermissionDenied: () => void;
  requestPreparedHistory: (sessionId: string) => Promise<PreparedPagedTerminalHistory | null>;
  startHistoryWarmup: () => void;
  invalidateHistory: (sessionId: string, reason?: string) => void;
  setSurfaceActive: (surfaceId: string, active: boolean) => void;
}>;

export const TerminalSessionCatalogContext = createContext<TerminalSessionCatalogValue>();

function buildLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function terminalHistoryWarmupPerformanceStage(
  event: TerminalHistoryWarmupEvent['event'],
): TerminalPerformanceStage {
  switch (event) {
    case 'start': return 'history-prefetch-start';
    case 'ready': return 'history-prefetch-ready';
    case 'skipped': return 'history-prefetch-skipped';
    case 'evicted': return 'history-prefetch-evicted';
    case 'paused': return 'warm-queue-paused';
    case 'complete': return 'warm-queue-complete';
  }
}

export function TerminalSessionCatalogProvider(props: ParentProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const [sessions, setSessions] = createSignal<readonly TerminalSessionInfo[]>([]);
  const [hydrated, setHydrated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [permissionDenied, setPermissionDenied] = createSignal(false);
  const [connectionEpoch, setConnectionEpoch] = createSignal(0);
  const [coordinator, setCoordinator] = createSignal<TerminalSessionsCoordinator | null>(null);

  let activeClient: object | null = null;
  let activeEnvId = '';
  let activeCoordinator: TerminalSessionsCoordinator | null = null;
  let unsubscribeCoordinator: (() => void) | null = null;
  let unsubscribeForegroundCommand: (() => void) | null = null;
  let preloadCancel: (() => void) | null = null;
  let lifecycleRevision = 0;
  let refreshRequestSequence = 0;
  let providerDisposed = false;
  let coordinatorHydrated = false;
  let historyWarmup: TerminalHistoryWarmup | null = null;
  let deniedClient: object | null = null;
  let deniedEnvId = '';
  let deniedPermissions: unknown = null;
  const activeSurfaceIds = new Set<string>();
  const removedSessionIds = new Set<string>();
  const pendingForegroundCommands = new Map<string, TerminalForegroundCommandInfo>();
  const pendingForegroundCommandLimit = 512;
  let pendingForegroundCommandOverflowRevision = 0;
  let pendingForegroundCommandReconcile: Promise<void> | null = null;
  let schedulePendingForegroundCommandReconcile = () => undefined;

  const retainPendingForegroundCommand = (
    sessionId: string,
    foregroundCommand: TerminalForegroundCommandInfo,
  ) => {
    const existing = pendingForegroundCommands.get(sessionId);
    if (existing && existing.revision >= foregroundCommand.revision) return;
    pendingForegroundCommands.delete(sessionId);
    pendingForegroundCommands.set(sessionId, foregroundCommand);
    while (pendingForegroundCommands.size > pendingForegroundCommandLimit) {
      const oldest = pendingForegroundCommands.keys().next().value;
      if (typeof oldest !== 'string') break;
      pendingForegroundCommands.delete(oldest);
      pendingForegroundCommandOverflowRevision += 1;
      schedulePendingForegroundCommandReconcile();
    }
  };

  const applyForegroundCommand = (
    sessionId: string,
    foregroundCommand: TerminalForegroundCommandInfo,
  ): boolean => {
    const current = activeCoordinator;
    if (!current || !current.getSnapshot().some((session) => session.id === sessionId)) {
      retainPendingForegroundCommand(sessionId, foregroundCommand);
      return false;
    }
    pendingForegroundCommands.delete(sessionId);
    current.updateSessionMeta(sessionId, { foregroundCommand });
    return true;
  };

  const flushPendingForegroundCommands = (current: TerminalSessionsCoordinator) => {
    const visibleIds = new Set(current.getSnapshot().map((session) => session.id));
    for (const [sessionId, foregroundCommand] of pendingForegroundCommands) {
      if (!visibleIds.has(sessionId)) continue;
      pendingForegroundCommands.delete(sessionId);
      current.updateSessionMeta(sessionId, { foregroundCommand });
    }
  };

  const applySnapshot = (next: TerminalSessionInfo[], authoritative = false) => {
    const authoritativeIds = new Set(next.map((session) => session.id));
    const visible = next.filter((session) => !removedSessionIds.has(session.id));
    if (authoritative) {
      for (const removedId of [...removedSessionIds]) {
        if (!authoritativeIds.has(removedId)) removedSessionIds.delete(removedId);
      }
    }
    const frozen = Object.freeze([...visible]);
    setSessions(frozen);
    historyWarmup?.syncSessions(frozen);
  };

  const clearPermissionDenied = () => {
    deniedClient = null;
    deniedEnvId = '';
    deniedPermissions = null;
    setPermissionDenied(false);
  };

  const markPermissionDenied = (client: object | null, envId: string, permissions: unknown) => {
    deniedClient = client;
    deniedEnvId = envId;
    deniedPermissions = permissions;
    setPermissionDenied(true);
  };

  const disposeConnection = (preserveSnapshot: boolean) => {
    lifecycleRevision += 1;
    refreshRequestSequence += 1;
    unsubscribeCoordinator?.();
    unsubscribeCoordinator = null;
    unsubscribeForegroundCommand?.();
    unsubscribeForegroundCommand = null;
    pendingForegroundCommands.clear();
    pendingForegroundCommandReconcile = null;
    activeCoordinator?.dispose();
    activeCoordinator = null;
    activeClient = null;
    coordinatorHydrated = false;
    historyWarmup?.dispose();
    historyWarmup = null;
    setCoordinator(null);
    if (!preserveSnapshot) {
      removedSessionIds.clear();
      applySnapshot([]);
      setHydrated(false);
      setError(null);
    }
    setLoading(false);
  };

  const ensureCoordinator = (client: object): TerminalSessionsCoordinator => {
    if (activeCoordinator && activeClient === client) return activeCoordinator;
    disposeConnection(true);
    activeClient = client;
    const next = createRedevenTerminalSessionsCoordinator({
      transport: createRedevenTerminalCatalogTransport(rpc),
      logger: buildLogger(),
      // Disable periodic polling; explicit provider refreshes track catalog state transitions.
      pollMs: 0,
    });
    for (const session of sessions()) next.upsertSession(session);
    activeCoordinator = next;
    const deviceMemoryGiB = typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const connection = typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    historyWarmup = createTerminalHistoryWarmup({
      budgetBytes: Math.min(32 * 1024 * 1024, Math.floor(resolveTerminalWarmBudgetBytes(deviceMemoryGiB) / 8)),
      saveData: connection?.saveData === true,
      fetchPage: (sessionId, request) => createRedevenPagedHistoryFetcher(rpc, sessionId)(request),
      onEvent: (event) => {
        const sessionRef = event.sessionId ? pseudonymousTerminalSessionRef(event.sessionId) : undefined;
        const stage = terminalHistoryWarmupPerformanceStage(event.event);
        publishDebugConsoleStructuredEvent({
          created_at: new Date().toISOString(),
          source: 'ui',
          scope: 'terminal_warmup',
          kind: stage ?? `history-prefetch-${event.event}`,
          trace_id: sessionRef ? `terminal-warmup-${sessionRef}` : undefined,
          duration_ms: event.durationMs,
          message: `Terminal history prefetch ${event.event}`,
          detail: {
            session_ref: sessionRef,
            page_count: event.pageCount,
            byte_length: event.byteLength,
            reason: event.reason,
          },
        });
        markTerminalPerformance(stage, {
          session_ref: sessionRef,
          page_count: event.pageCount,
          byte_length: event.byteLength,
          duration_ms: event.durationMs,
          reason: event.reason,
        });
      },
    });
    historyWarmup.setPageActive(activeSurfaceIds.size > 0);
    if (typeof document !== 'undefined') historyWarmup.setPageHidden(document.hidden);
    setCoordinator(next);
    unsubscribeCoordinator = next.subscribe((snapshot) => {
      if (!coordinatorHydrated && snapshot.length === 0) return;
      applySnapshot(snapshot);
    });
    unsubscribeForegroundCommand = rpc.terminal.onForegroundCommandUpdate((event) => {
      const sessionId = String(event.sessionId ?? '').trim();
      if (!sessionId || removedSessionIds.has(sessionId)) return;
      applyForegroundCommand(sessionId, event.foregroundCommand);
    });
    setConnectionEpoch((value) => value + 1);
    return next;
  };

  const refresh = async (): Promise<void> => {
    if (providerDisposed) return;
    const client = protocol.client();
    const canUseCatalog = protocol.status() === 'connected'
      && Boolean(client)
      && env.env.state === 'ready'
      && canLaunchProcess(env.env()?.permissions);
    if (!canUseCatalog || !client) return;
    const current = ensureCoordinator(client);
    const revision = lifecycleRevision;
    const requestSequence = ++refreshRequestSequence;
    setLoading(true);
    markTerminalPerformance('catalog-start', { connection_epoch: connectionEpoch() });
    try {
      await current.refresh();
      if (
        revision !== lifecycleRevision
        || requestSequence !== refreshRequestSequence
        || current !== activeCoordinator
      ) return;
      flushPendingForegroundCommands(current);
      coordinatorHydrated = true;
      applySnapshot(current.getSnapshot(), true);
      setHydrated(true);
      setStale(false);
      setError(null);
      markTerminalPerformance('catalog-ready', {
        connection_epoch: connectionEpoch(),
        session_count: current.getSnapshot().length,
      });
    } catch (cause) {
      if (
        revision !== lifecycleRevision
        || requestSequence !== refreshRequestSequence
        || current !== activeCoordinator
      ) return;
      if (isPermissionDeniedError(cause, 'process')) {
        disposeConnection(false);
        setStale(false);
        markPermissionDenied(client, String(env.env_id() ?? '').trim(), env.env()?.permissions);
        return;
      }
      if (!isPermissionDeniedError(cause, 'process')) {
        setError(normalizeError(cause));
      }
      setStale(true);
      throw cause;
    } finally {
      if (
        revision === lifecycleRevision
        && requestSequence === refreshRequestSequence
        && current === activeCoordinator
      ) {
        setLoading(false);
      }
    }
  };

  schedulePendingForegroundCommandReconcile = () => {
    if (pendingForegroundCommandReconcile || providerDisposed) return;
    const scheduledLifecycleRevision = lifecycleRevision;
    let reconciledOverflowRevision = -1;
    const reconcile = (async () => {
      while (
        !providerDisposed
        && scheduledLifecycleRevision === lifecycleRevision
        && reconciledOverflowRevision !== pendingForegroundCommandOverflowRevision
      ) {
        reconciledOverflowRevision = pendingForegroundCommandOverflowRevision;
        const joinedExistingRefresh = loading();
        try {
          await refresh();
          if (joinedExistingRefresh && scheduledLifecycleRevision === lifecycleRevision) {
            await refresh();
          }
        } catch {
          return;
        }
      }
    })();
    let trackedReconcile: Promise<void>;
    trackedReconcile = reconcile.finally(() => {
      if (pendingForegroundCommandReconcile === trackedReconcile) {
        pendingForegroundCommandReconcile = null;
        if (
          !providerDisposed
          && reconciledOverflowRevision !== pendingForegroundCommandOverflowRevision
        ) {
          schedulePendingForegroundCommandReconcile();
        }
      }
    });
    pendingForegroundCommandReconcile = trackedReconcile;
  };

  const getCoordinator = (): TerminalSessionsCoordinator | null => {
    if (providerDisposed) return null;
    const client = protocol.client();
    if (!client || protocol.status() !== 'connected') return null;
    if (env.env.state !== 'ready' || !canLaunchProcess(env.env()?.permissions)) return null;
    return ensureCoordinator(client);
  };

  const upsertSession = (session: TerminalSessionInfo) => {
    removedSessionIds.delete(String(session.id ?? '').trim());
    const current = getCoordinator();
    if (current) {
      current.upsertSession(session);
      flushPendingForegroundCommands(current);
      return;
    }
    applySnapshot([...sessions().filter((candidate) => candidate.id !== session.id), session]);
  };

  const removeSession = (sessionId: string) => {
    const normalized = String(sessionId ?? '').trim();
    if (normalized) {
      removedSessionIds.add(normalized);
      pendingForegroundCommands.delete(normalized);
      historyWarmup?.invalidate(normalized, 'removed');
      const current = getCoordinator();
      if (current) current.removeSession(normalized);
      else applySnapshot(sessions().filter((session) => session.id !== normalized));
    }
  };

  const updateSessionMeta = (sessionId: string, patch: {
    name?: string;
    workingDir?: string;
    lastActiveAtMs?: number;
    isActive?: boolean;
    foregroundCommand?: TerminalForegroundCommandInfo;
  }) => {
    const normalized = String(sessionId ?? '').trim();
    if (!normalized) return;
    const current = getCoordinator();
    if (current) {
      current.updateSessionMeta(normalized, patch);
      return;
    }
    applySnapshot(sessions().map((session) => (
      session.id === normalized ? { ...session, ...patch } : session
    )));
  };

  const clearForPermissionDenied = () => {
    preloadCancel?.();
    preloadCancel = null;
    disposeConnection(false);
    setStale(false);
    markPermissionDenied(
      protocol.client(),
      String(env.env_id() ?? '').trim(),
      env.env()?.permissions,
    );
  };

  const requestPreparedHistory = (sessionId: string) => (
    historyWarmup?.request(sessionId, 'interactive') ?? Promise.resolve(null)
  );

  const startHistoryWarmup = () => historyWarmup?.start();

  const invalidateHistory = (sessionId: string, reason?: string) => {
    historyWarmup?.invalidate(sessionId, reason);
  };

  const setSurfaceActive = (surfaceId: string, active: boolean) => {
    const id = String(surfaceId ?? '').trim();
    if (!id) return;
    if (active) activeSurfaceIds.add(id);
    else activeSurfaceIds.delete(id);
    historyWarmup?.setPageActive(activeSurfaceIds.size > 0);
  };

  if (typeof document !== 'undefined') {
    const onVisibilityChange = () => historyWarmup?.setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    onCleanup(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  }

  createEffect(() => {
    const envId = String(env.env_id() ?? '').trim();
    const client = protocol.client();
    const connected = protocol.status() === 'connected' && Boolean(client);
    const permissionReady = env.env.state === 'ready';
    const permissions = env.env()?.permissions;
    const allowed = permissionReady && canLaunchProcess(permissions);
    const serverDenialIsCurrent = permissionDenied()
      && deniedClient === client
      && deniedEnvId === envId
      && deniedPermissions === permissions;

    if (activeEnvId && activeEnvId !== envId) {
      clearPermissionDenied();
      disposeConnection(false);
    }
    activeEnvId = envId;

    if (!permissionReady) {
      clearPermissionDenied();
      preloadCancel?.();
      preloadCancel = null;
      disposeConnection(false);
      setStale(false);
      return;
    }

    if (!allowed) {
      preloadCancel?.();
      preloadCancel = null;
      disposeConnection(false);
      setStale(false);
      markPermissionDenied(client, envId, permissions);
      return;
    }

    if (serverDenialIsCurrent) {
      preloadCancel?.();
      preloadCancel = null;
      disposeConnection(false);
      setStale(false);
      return;
    }

    if (permissionDenied()) {
      clearPermissionDenied();
      return;
    }

    if (!connected || !client) {
      disposeConnection(true);
      setStale(hydrated());
      return;
    }

    untrack(() => ensureCoordinator(client));
    void untrack(() => refresh()).catch(() => undefined);

    preloadCancel?.();
    preloadCancel = scheduleTerminalFeaturePreload({ reason: 'idle' });
    onCleanup(() => {
      preloadCancel?.();
      preloadCancel = null;
    });
  });

  onCleanup(() => {
    providerDisposed = true;
    preloadCancel?.();
    disposeConnection(false);
  });

  const value: TerminalSessionCatalogValue = {
    sessions,
    hydrated,
    loading,
    stale,
    error,
    permissionDenied,
    connectionEpoch,
    coordinator,
    getCoordinator,
    refresh,
    upsertSession,
    removeSession,
    updateSessionMeta,
    clearForPermissionDenied,
    requestPreparedHistory,
    startHistoryWarmup,
    invalidateHistory,
    setSurfaceActive,
  };

  return (
    <TerminalSessionCatalogContext.Provider value={value}>
      <TerminalSessionsLifecycleSync
        refresh={refresh}
        removeSession={removeSession}
        refreshOnConnect={false}
      />
      {props.children}
    </TerminalSessionCatalogContext.Provider>
  );
}

export function useTerminalSessionCatalog(): TerminalSessionCatalogValue | null {
  return useContext(TerminalSessionCatalogContext) ?? null;
}
