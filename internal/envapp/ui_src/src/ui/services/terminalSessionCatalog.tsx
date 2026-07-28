import { createContext, createEffect, createSignal, onCleanup, untrack, useContext, type Accessor, type ParentProps } from 'solid-js';
import type {
  TerminalExecutionContextInfo,
  TerminalForegroundCommandInfo,
  TerminalOutputActivityInfo,
  TerminalSessionsCoordinator,
  TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web/sessions';
import type { TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';
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
  remoteOpeningObservedAtMs: (sessionId: string) => number | undefined;
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
    outputActivity?: TerminalOutputActivityInfo;
    executionContext?: TerminalExecutionContextInfo;
    workState?: TerminalWorkStateInfo;
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

function conflictedExecutionContext(
  context: TerminalExecutionContextInfo,
): TerminalExecutionContextInfo {
  return {
    location: {
      kind: 'unknown',
      phase: 'unknown',
      label: '',
      authority: '',
      workingDirectory: '',
      source: 'unknown',
    },
    application: { kind: 'unknown', identity: '', displayName: '' },
    revision: context.revision,
    updatedAtMs: context.updatedAtMs,
  };
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
  const [remoteOpeningEpochRevision, setRemoteOpeningEpochRevision] = createSignal(0);
  const [coordinator, setCoordinator] = createSignal<TerminalSessionsCoordinator | null>(null);

  let activeClient: object | null = null;
  let activeEnvId = '';
  let activeCoordinator: TerminalSessionsCoordinator | null = null;
  let unsubscribeCoordinator: (() => void) | null = null;
  let unsubscribeForegroundCommand: (() => void) | null = null;
  let unsubscribeOutputActivity: (() => void) | null = null;
  let unsubscribeExecutionContext: (() => void) | null = null;
  let unsubscribeWorkState: (() => void) | null = null;
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
  const pendingOutputActivities = new Map<string, TerminalOutputActivityInfo>();
  const latestOutputActivities = new Map<string, TerminalOutputActivityInfo>();
  const latestExecutionContexts = new Map<string, TerminalExecutionContextInfo>();
  const latestWorkStates = new Map<string, TerminalWorkStateInfo>();
  const pendingMetadataConflictKeys = new Map<string, number>();
  const pendingExecutionContextConflicts = new Map<string, Readonly<{
    context: TerminalExecutionContextInfo;
    generation: number;
  }>>();
  const remoteOpeningObservedAtBySession = new Map<string, number>();
  const pendingMetadataLimit = 512;
  let pendingMetadataOverflowRevision = 0;
  let pendingMetadataReconcile: Promise<void> | null = null;
  let pendingMetadataRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingMetadataRetryDelayMs = 50;
  let pendingExecutionContextConflictOverflowGeneration = 0;
  let schedulePendingMetadataReconcile = () => undefined;

  const scheduleEarlyMetadataConflictReconcile = (key: string): Readonly<{
    generation: number;
    tracked: boolean;
  }> => {
    const existingGeneration = pendingMetadataConflictKeys.get(key);
    if (existingGeneration != null) return { generation: existingGeneration, tracked: true };
    pendingMetadataOverflowRevision += 1;
    const tracked = pendingMetadataConflictKeys.size < pendingMetadataLimit;
    if (tracked) pendingMetadataConflictKeys.set(key, pendingMetadataOverflowRevision);
    schedulePendingMetadataReconcile();
    return { generation: pendingMetadataOverflowRevision, tracked };
  };

  const schedulePendingMetadataReconcileRetry = () => {
    if (pendingMetadataRetryTimer != null || providerDisposed) return;
    const scheduledLifecycleRevision = lifecycleRevision;
    const delayMs = pendingMetadataRetryDelayMs;
    pendingMetadataRetryDelayMs = Math.min(pendingMetadataRetryDelayMs * 2, 2_000);
    pendingMetadataRetryTimer = globalThis.setTimeout(() => {
      pendingMetadataRetryTimer = null;
      if (providerDisposed || scheduledLifecycleRevision !== lifecycleRevision) return;
      schedulePendingMetadataReconcile();
    }, delayMs);
  };

  const retainPendingForegroundCommand = (
    sessionId: string,
    foregroundCommand: TerminalForegroundCommandInfo,
  ) => {
    const existing = pendingForegroundCommands.get(sessionId);
    if (existing && existing.revision >= foregroundCommand.revision) return;
    pendingForegroundCommands.delete(sessionId);
    pendingForegroundCommands.set(sessionId, foregroundCommand);
    while (pendingForegroundCommands.size > pendingMetadataLimit) {
      const oldest = pendingForegroundCommands.keys().next().value;
      if (typeof oldest !== 'string') break;
      pendingForegroundCommands.delete(oldest);
      pendingMetadataOverflowRevision += 1;
      schedulePendingMetadataReconcile();
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
    const latestWorkState = latestWorkStates.get(sessionId);
    if (latestWorkState) {
      current.updateSessionMeta(sessionId, { workState: latestWorkState });
      latestWorkStates.delete(sessionId);
    }
    return true;
  };

  const retainLatestExecutionContext = (
    sessionId: string,
    executionContext: TerminalExecutionContextInfo,
  ): boolean => {
    const existing = latestExecutionContexts.get(sessionId);
    if (existing && existing.revision >= executionContext.revision) {
      if (existing.revision === executionContext.revision
        && JSON.stringify(existing) !== JSON.stringify(executionContext)) {
        const scheduled = scheduleEarlyMetadataConflictReconcile(
          `context:${sessionId}:${executionContext.revision}`,
        );
        if (scheduled.tracked) {
          pendingExecutionContextConflicts.set(sessionId, {
            context: conflictedExecutionContext(existing),
            generation: scheduled.generation,
          });
        } else {
          pendingExecutionContextConflictOverflowGeneration = Math.max(
            pendingExecutionContextConflictOverflowGeneration,
            scheduled.generation,
          );
        }
      }
      return false;
    }
    if ((pendingExecutionContextConflicts.get(sessionId)?.context.revision ?? -1) < executionContext.revision) {
      pendingExecutionContextConflicts.delete(sessionId);
    }
    latestExecutionContexts.delete(sessionId);
    latestExecutionContexts.set(sessionId, executionContext);
    while (latestExecutionContexts.size > pendingMetadataLimit) {
      const oldest = latestExecutionContexts.keys().next().value;
      if (typeof oldest !== 'string') break;
      latestExecutionContexts.delete(oldest);
      latestWorkStates.delete(oldest);
      pendingMetadataOverflowRevision += 1;
      schedulePendingMetadataReconcile();
    }
    return true;
  };

  const retainLatestWorkState = (sessionId: string, workState: TerminalWorkStateInfo): boolean => {
    const existing = latestWorkStates.get(sessionId);
    if (existing && existing.revision >= workState.revision) {
      if (existing.revision === workState.revision
        && JSON.stringify(existing) !== JSON.stringify(workState)) {
        scheduleEarlyMetadataConflictReconcile(`work:${sessionId}:${workState.revision}`);
      }
      return false;
    }
    latestWorkStates.delete(sessionId);
    latestWorkStates.set(sessionId, workState);
    while (latestWorkStates.size > pendingMetadataLimit) {
      const oldest = latestWorkStates.keys().next().value;
      if (typeof oldest !== 'string') break;
      latestWorkStates.delete(oldest);
      pendingMetadataOverflowRevision += 1;
      schedulePendingMetadataReconcile();
    }
    return true;
  };

  const applyExecutionContext = (
    sessionId: string,
    executionContext: TerminalExecutionContextInfo,
  ): boolean => {
    const current = activeCoordinator;
    const existingSession = current?.getSnapshot().find((session) => session.id === sessionId);
    if (!current || !existingSession) {
      retainLatestExecutionContext(sessionId, executionContext);
      return false;
    }
    if ((existingSession.executionContext?.revision ?? -1) <= executionContext.revision) {
      current.updateSessionMeta(sessionId, { executionContext });
    }
    latestExecutionContexts.delete(sessionId);
    const latestWorkState = latestWorkStates.get(sessionId);
    if (latestWorkState) {
      if ((existingSession.workState?.revision ?? -1) <= latestWorkState.revision) {
        current.updateSessionMeta(sessionId, { workState: latestWorkState });
      }
      latestWorkStates.delete(sessionId);
    }
    return true;
  };

  const applyWorkState = (sessionId: string, workState: TerminalWorkStateInfo): boolean => {
    const current = activeCoordinator;
    const existingSession = current?.getSnapshot().find((session) => session.id === sessionId);
    if (!current || !existingSession) {
      retainLatestWorkState(sessionId, workState);
      return false;
    }
    if ((existingSession.workState?.revision ?? -1) <= workState.revision) {
      current.updateSessionMeta(sessionId, { workState });
    }
    latestWorkStates.delete(sessionId);
    return true;
  };

  const retainPendingOutputActivity = (
    sessionId: string,
    outputActivity: TerminalOutputActivityInfo,
  ) => {
    const existing = pendingOutputActivities.get(sessionId);
    if (existing && existing.revision >= outputActivity.revision) return;
    pendingOutputActivities.delete(sessionId);
    pendingOutputActivities.set(sessionId, outputActivity);
    while (pendingOutputActivities.size > pendingMetadataLimit) {
      const oldest = pendingOutputActivities.keys().next().value;
      if (typeof oldest !== 'string') break;
      const evicted = pendingOutputActivities.get(oldest);
      pendingOutputActivities.delete(oldest);
      if (latestOutputActivities.get(oldest)?.revision === evicted?.revision) {
        latestOutputActivities.delete(oldest);
      }
      pendingMetadataOverflowRevision += 1;
      schedulePendingMetadataReconcile();
    }
  };

  const applyOutputActivity = (
    sessionId: string,
    outputActivity: TerminalOutputActivityInfo,
  ): boolean => {
    const current = activeCoordinator;
    const existingSession = current?.getSnapshot().find((session) => session.id === sessionId);
    const latest = latestOutputActivities.get(sessionId);
    if (latest && latest.revision >= outputActivity.revision) return false;
    const snapshotActivity = existingSession?.outputActivity;
    if (snapshotActivity && snapshotActivity.revision >= outputActivity.revision) {
      latestOutputActivities.set(sessionId, snapshotActivity);
      pendingOutputActivities.delete(sessionId);
      return false;
    }
    latestOutputActivities.set(sessionId, outputActivity);
    if (!current || !existingSession) {
      retainPendingOutputActivity(sessionId, outputActivity);
      return false;
    }
    pendingOutputActivities.delete(sessionId);
    if ((existingSession.outputActivity?.revision ?? -1) >= outputActivity.revision) return false;
    current.updateSessionMeta(sessionId, { outputActivity });
    return true;
  };

  const flushPendingMetadata = (current: TerminalSessionsCoordinator) => {
    const snapshotById = new Map(current.getSnapshot().map((session) => [session.id, session]));
    for (const [sessionId, foregroundCommand] of pendingForegroundCommands) {
      if (!snapshotById.has(sessionId)) continue;
      pendingForegroundCommands.delete(sessionId);
      current.updateSessionMeta(sessionId, { foregroundCommand });
    }
    for (const [sessionId, outputActivity] of pendingOutputActivities) {
      const existing = snapshotById.get(sessionId);
      if (!existing) continue;
      pendingOutputActivities.delete(sessionId);
      if ((existing.outputActivity?.revision ?? -1) >= outputActivity.revision) {
        if (existing.outputActivity) latestOutputActivities.set(sessionId, existing.outputActivity);
        continue;
      }
      current.updateSessionMeta(sessionId, { outputActivity });
    }
    for (const [sessionId, executionContext] of latestExecutionContexts) {
      const existing = snapshotById.get(sessionId);
      if (!existing) continue;
      latestExecutionContexts.delete(sessionId);
      if ((existing.executionContext?.revision ?? -1) <= executionContext.revision) {
        current.updateSessionMeta(sessionId, { executionContext });
      }
    }
    for (const [sessionId, workState] of latestWorkStates) {
      if (!snapshotById.has(sessionId)) continue;
      latestWorkStates.delete(sessionId);
      current.updateSessionMeta(sessionId, { workState });
    }
  };

  const convergeOutputActivities = (current: TerminalSessionsCoordinator) => {
    for (const session of current.getSnapshot()) {
      const latest = latestOutputActivities.get(session.id);
      const snapshotActivity = session.outputActivity;
      if (latest && latest.revision > (snapshotActivity?.revision ?? -1)) {
        current.updateSessionMeta(session.id, { outputActivity: latest });
      } else if (snapshotActivity) {
        latestOutputActivities.set(session.id, snapshotActivity);
      }
    }
  };

  const convergeContextAndWork = (current: TerminalSessionsCoordinator) => {
    for (const session of current.getSnapshot()) {
      const latestContext = latestExecutionContexts.get(session.id);
      if (latestContext && latestContext.revision >= (session.executionContext?.revision ?? -1)) {
        current.updateSessionMeta(session.id, { executionContext: latestContext });
      }
      latestExecutionContexts.delete(session.id);
      const latestWork = latestWorkStates.get(session.id);
      if (latestWork && latestWork.revision >= (session.workState?.revision ?? -1)) {
        current.updateSessionMeta(session.id, { workState: latestWork });
      }
      latestWorkStates.delete(session.id);
    }
  };

  const applySnapshot = (next: TerminalSessionInfo[], authoritative = false) => {
    const authoritativeIds = new Set(next.map((session) => session.id));
    const visible = next
      .filter((session) => !removedSessionIds.has(session.id))
      .map((session) => {
        let projected = session;
        const latest = latestOutputActivities.get(session.id);
        const snapshotActivity = session.outputActivity;
        if (latest && latest.revision > (snapshotActivity?.revision ?? -1)) {
          projected = { ...projected, outputActivity: latest };
        } else if (snapshotActivity) {
          latestOutputActivities.set(session.id, snapshotActivity);
        }
        const contextConflict = pendingExecutionContextConflicts.get(session.id);
        if (pendingExecutionContextConflictOverflowGeneration > 0 && projected.executionContext) {
          projected = {
            ...projected,
            executionContext: conflictedExecutionContext(projected.executionContext),
          };
        } else if (contextConflict
          && contextConflict.context.revision >= (projected.executionContext?.revision ?? -1)) {
          projected = { ...projected, executionContext: contextConflict.context };
        }
        return projected;
      });
    if (authoritative) {
      for (const removedId of [...removedSessionIds]) {
        if (!authoritativeIds.has(removedId)) removedSessionIds.delete(removedId);
      }
      for (const sessionId of latestOutputActivities.keys()) {
        if (!authoritativeIds.has(sessionId) && !pendingOutputActivities.has(sessionId)) {
          latestOutputActivities.delete(sessionId);
        }
      }
      for (const sessionId of latestExecutionContexts.keys()) {
        if (!authoritativeIds.has(sessionId)) latestExecutionContexts.delete(sessionId);
      }
      for (const sessionId of pendingExecutionContextConflicts.keys()) {
        if (!authoritativeIds.has(sessionId)) pendingExecutionContextConflicts.delete(sessionId);
      }
      for (const sessionId of latestWorkStates.keys()) {
        if (!authoritativeIds.has(sessionId)) latestWorkStates.delete(sessionId);
      }
    }
    const openingSessionIds = new Set<string>();
    let openingEpochsChanged = false;
    const observedAtMs = Date.now();
    for (const session of visible) {
      if (session.executionContext?.location.kind !== 'remote'
        || session.executionContext.location.phase !== 'opening') continue;
      openingSessionIds.add(session.id);
      if (!remoteOpeningObservedAtBySession.has(session.id)) {
        remoteOpeningObservedAtBySession.set(session.id, observedAtMs);
        openingEpochsChanged = true;
      }
    }
    for (const sessionId of remoteOpeningObservedAtBySession.keys()) {
      if (openingSessionIds.has(sessionId)) continue;
      remoteOpeningObservedAtBySession.delete(sessionId);
      openingEpochsChanged = true;
    }
    if (openingEpochsChanged) setRemoteOpeningEpochRevision((value) => value + 1);

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
    unsubscribeOutputActivity?.();
    unsubscribeOutputActivity = null;
    unsubscribeExecutionContext?.();
    unsubscribeExecutionContext = null;
    unsubscribeWorkState?.();
    unsubscribeWorkState = null;
    pendingForegroundCommands.clear();
    pendingOutputActivities.clear();
    latestOutputActivities.clear();
    latestExecutionContexts.clear();
    latestWorkStates.clear();
    pendingMetadataConflictKeys.clear();
    pendingExecutionContextConflicts.clear();
    pendingExecutionContextConflictOverflowGeneration = 0;
    if (remoteOpeningObservedAtBySession.size > 0) {
      remoteOpeningObservedAtBySession.clear();
      setRemoteOpeningEpochRevision((value) => value + 1);
    }
    pendingMetadataReconcile = null;
    if (pendingMetadataRetryTimer != null) {
      globalThis.clearTimeout(pendingMetadataRetryTimer);
      pendingMetadataRetryTimer = null;
    }
    pendingMetadataRetryDelayMs = 50;
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
    const terminalRpc = (rpc as { terminal?: Partial<(typeof rpc)['terminal']> }).terminal;
    if (terminalRpc && typeof terminalRpc.onForegroundCommandUpdate === 'function') {
      unsubscribeForegroundCommand = terminalRpc.onForegroundCommandUpdate((event) => {
        const sessionId = String(event.sessionId ?? '').trim();
        if (!sessionId || removedSessionIds.has(sessionId)) return;
        applyForegroundCommand(sessionId, event.foregroundCommand);
      });
    }
    if (terminalRpc && typeof terminalRpc.onOutputActivityUpdate === 'function') {
      unsubscribeOutputActivity = terminalRpc.onOutputActivityUpdate((event) => {
        const sessionId = String(event.sessionId ?? '').trim();
        if (!sessionId || removedSessionIds.has(sessionId)) return;
        applyOutputActivity(sessionId, event.outputActivity);
      });
    }
    if (terminalRpc && typeof terminalRpc.onExecutionContextUpdate === 'function') {
      unsubscribeExecutionContext = terminalRpc.onExecutionContextUpdate((event) => {
        const sessionId = String(event.sessionId ?? '').trim();
        if (!sessionId || removedSessionIds.has(sessionId)) return;
        applyExecutionContext(sessionId, event.executionContext);
      });
    }
    if (terminalRpc && typeof terminalRpc.onWorkStateUpdate === 'function') {
      unsubscribeWorkState = terminalRpc.onWorkStateUpdate((event) => {
        const sessionId = String(event.sessionId ?? '').trim();
        if (!sessionId || removedSessionIds.has(sessionId)) return;
        applyWorkState(sessionId, event.workState);
      });
    }
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
      convergeOutputActivities(current);
      convergeContextAndWork(current);
      flushPendingMetadata(current);
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

  schedulePendingMetadataReconcile = () => {
    if (pendingMetadataReconcile || providerDisposed) return;
    const scheduledLifecycleRevision = lifecycleRevision;
    let reconciledOverflowRevision = -1;
    let retryAfterFailure = false;
    const reconcile = (async () => {
      while (
        !providerDisposed
        && scheduledLifecycleRevision === lifecycleRevision
        && reconciledOverflowRevision !== pendingMetadataOverflowRevision
      ) {
        let targetOverflowRevision = pendingMetadataOverflowRevision;
        const joinedExistingRefresh = loading();
        try {
          await refresh();
          if (joinedExistingRefresh && scheduledLifecycleRevision === lifecycleRevision) {
            targetOverflowRevision = pendingMetadataOverflowRevision;
            await refresh();
          }
        } catch {
          retryAfterFailure = true;
          return;
        }
        reconciledOverflowRevision = targetOverflowRevision;
        for (const [key, generation] of pendingMetadataConflictKeys) {
          if (generation <= targetOverflowRevision) pendingMetadataConflictKeys.delete(key);
        }
        for (const [sessionId, conflict] of pendingExecutionContextConflicts) {
          if (conflict.generation <= targetOverflowRevision) {
            pendingExecutionContextConflicts.delete(sessionId);
          }
        }
        if (pendingExecutionContextConflictOverflowGeneration <= targetOverflowRevision) {
          pendingExecutionContextConflictOverflowGeneration = 0;
        }
        const reconciledCoordinator = activeCoordinator;
        if (reconciledCoordinator && scheduledLifecycleRevision === lifecycleRevision) {
          applySnapshot(reconciledCoordinator.getSnapshot(), true);
        }
        pendingMetadataRetryDelayMs = 50;
      }
    })();
    let trackedReconcile: Promise<void>;
    trackedReconcile = reconcile.finally(() => {
      if (pendingMetadataReconcile === trackedReconcile) {
        pendingMetadataReconcile = null;
        if (
          !providerDisposed
          && scheduledLifecycleRevision === lifecycleRevision
          && reconciledOverflowRevision !== pendingMetadataOverflowRevision
        ) {
          if (retryAfterFailure) {
            schedulePendingMetadataReconcileRetry();
          } else {
            schedulePendingMetadataReconcile();
          }
        }
      }
    });
    pendingMetadataReconcile = trackedReconcile;
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
      flushPendingMetadata(current);
      return;
    }
    applySnapshot([...sessions().filter((candidate) => candidate.id !== session.id), session]);
  };

  const removeSession = (sessionId: string) => {
    const normalized = String(sessionId ?? '').trim();
    if (normalized) {
      removedSessionIds.add(normalized);
      pendingForegroundCommands.delete(normalized);
      pendingOutputActivities.delete(normalized);
      latestOutputActivities.delete(normalized);
      latestExecutionContexts.delete(normalized);
      latestWorkStates.delete(normalized);
      pendingExecutionContextConflicts.delete(normalized);
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
    outputActivity?: TerminalOutputActivityInfo;
    executionContext?: TerminalExecutionContextInfo;
    workState?: TerminalWorkStateInfo;
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

  const remoteOpeningObservedAtMs = (sessionId: string): number | undefined => {
    remoteOpeningEpochRevision();
    return remoteOpeningObservedAtBySession.get(String(sessionId ?? '').trim());
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
    remoteOpeningObservedAtMs,
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
