import { createContext, createEffect, createSignal, onCleanup, untrack, useContext, type Accessor, type ParentProps } from 'solid-js';
import type {
  TerminalExecutionContextInfo,
  TerminalForegroundCommandInfo,
  TerminalOutputActivityInfo,
  TerminalSessionInfo as FloetermTerminalSessionInfo,
  TerminalSessionsCoordinator,
  TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web/sessions';
import type {
  TerminalGroup,
  TerminalGroupCreateRequest,
  TerminalGroupDeleteResponse,
  TerminalGroupUpdateRequest,
  TerminalSessionInfo,
} from '../protocol/redeven_v1/sdk/terminal';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { useEnvContext } from '../pages/EnvContext';
import { canLaunchProcess, isPermissionDeniedError } from '../utils/permission';
import { createRedevenTerminalCatalogTransport } from './terminalCatalogTransport';
import { createRedevenTerminalSessionsCoordinator } from './terminalSessions';
import { TerminalSessionsLifecycleSync } from './terminalSessionsLifecycleSync';
import { markTerminalPerformance } from './terminalPerformance';
import {
  createTerminalTabActivityTracker,
  observeTerminalAgentAttentionStates,
} from './terminalTabActivity';

export type TerminalSessionCatalogValue = Readonly<{
  sessions: Accessor<readonly TerminalSessionInfo[]>;
  groups: Accessor<readonly TerminalGroup[]>;
  groupRevision: Accessor<number>;
  hydrated: Accessor<boolean>;
  loading: Accessor<boolean>;
  stale: Accessor<boolean>;
  error: Accessor<string | null>;
  permissionDenied: Accessor<boolean>;
  connectionEpoch: Accessor<number>;
  agentUnreadSessionIds: Accessor<ReadonlySet<string>>;
  setAgentSessionReader: (readerId: string, sessionId: string | null) => void;
  remoteOpeningObservedAtMs: (sessionId: string) => number | undefined;
  coordinator: Accessor<TerminalSessionsCoordinator | null>;
  getCoordinator: () => TerminalSessionsCoordinator | null;
  refresh: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  createGroup: (request: TerminalGroupCreateRequest) => Promise<TerminalGroup>;
  updateGroup: (request: TerminalGroupUpdateRequest) => Promise<TerminalGroup>;
  deleteGroup: (groupId: string) => Promise<TerminalGroupDeleteResponse>;
  moveSession: (sessionId: string, groupId: string) => Promise<void>;
  reorderSession: (sessionId: string, beforeSessionId: string | null) => void;
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
    localPathCapability?: TerminalSessionInfo['localPathCapability'] | null;
  }) => void;
  clearForPermissionDenied: () => void;
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

function terminalRuntimeSession(session: TerminalSessionInfo): FloetermTerminalSessionInfo {
  const { groupId: _groupId, ...runtime } = session;
  return runtime;
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

export function TerminalSessionCatalogProvider(props: ParentProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const [sessions, setSessions] = createSignal<readonly TerminalSessionInfo[]>([]);
  const [groups, setGroups] = createSignal<readonly TerminalGroup[]>([]);
  const [groupRevision, setGroupRevision] = createSignal(0);
  const [hydrated, setHydrated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [stale, setStale] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [permissionDenied, setPermissionDenied] = createSignal(false);
  const [connectionEpoch, setConnectionEpoch] = createSignal(0);
  const [remoteOpeningEpochRevision, setRemoteOpeningEpochRevision] = createSignal(0);
  const [coordinator, setCoordinator] = createSignal<TerminalSessionsCoordinator | null>(null);
  const [agentUnreadSessionIds, setAgentUnreadSessionIds] = createSignal<ReadonlySet<string>>(new Set());
  const agentReaderSessionById = new Map<string, string>();
  const agentAttentionTracker = createTerminalTabActivityTracker({
    publishVisualState: (sessionId, state) => {
      setAgentUnreadSessionIds((current) => {
        const unread = state === 'unread';
        if (current.has(sessionId) === unread) return current;
        const next = new Set(current);
        if (unread) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    },
  });

  let activeClient: object | null = null;
  let activeEnvId = '';
  let activeCoordinator: TerminalSessionsCoordinator | null = null;
  let unsubscribeCoordinator: (() => void) | null = null;
  let unsubscribeForegroundCommand: (() => void) | null = null;
  let unsubscribeOutputActivity: (() => void) | null = null;
  let unsubscribeExecutionContext: (() => void) | null = null;
  let unsubscribeWorkState: (() => void) | null = null;
  let unsubscribeGroupCatalog: (() => void) | null = null;
  let lifecycleRevision = 0;
  let refreshRequestSequence = 0;
  let groupRefreshRequestSequence = 0;
  let groupSnapshotRevision = 0;
  let nextGroupOperationSequence = 0;
  const latestGroupOperationByKey = new Map<string, number>();
  let nextSessionListRequestSequence = 0;
  let latestAppliedSessionListRequestSequence = 0;
  let latestAppliedSessionListMembershipRevision = 0;
  let sessionMembershipRevision = 0;
  const sessionGroupIdById = new Map<string, string>();
  const sessionGroupWriteRevisionById = new Map<string, number>();
  const sessionGroupCatalogRevisionById = new Map<string, number>();
  const pendingSessionGroupMoveById = new Map<string, Readonly<{
    operationSequence: number;
    previousGroupId: string;
    targetGroupId: string;
    startedCatalogRevision: number;
  }>>();
  let groupRefreshPromise: Promise<void> | null = null;
  let sessionOrderIds: string[] = [];
  let providerDisposed = false;
  let coordinatorHydrated = false;
  let deniedClient: object | null = null;
  let deniedEnvId = '';
  let deniedPermissions: unknown = null;
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
  const localPathCapabilityOverrides = new Map<
    string,
    TerminalSessionInfo['localPathCapability'] | null
  >();
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
    if (authoritative) {
      for (const sessionId of authoritativeIds) localPathCapabilityOverrides.delete(sessionId);
      for (const sessionId of localPathCapabilityOverrides.keys()) {
        if (!authoritativeIds.has(sessionId)) localPathCapabilityOverrides.delete(sessionId);
      }
    }
    const visible = next
      .filter((session) => !removedSessionIds.has(session.id))
      .map((session) => {
        let projected = session;
        if (localPathCapabilityOverrides.has(session.id)) {
          const capability = localPathCapabilityOverrides.get(session.id) ?? null;
          if (capability) {
            projected = { ...projected, localPathCapability: capability };
          } else {
            const { localPathCapability: _revoked, ...withoutCapability } = projected;
            projected = withoutCapability;
          }
        }
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
    const sessionById = new Map(visible.map((session) => [session.id, session]));
    const nextOrderIds = sessionOrderIds.filter((sessionId) => sessionById.has(sessionId));
    const orderedIds = new Set(nextOrderIds);
    for (const session of visible) {
      if (orderedIds.has(session.id)) continue;
      nextOrderIds.push(session.id);
      orderedIds.add(session.id);
    }
    sessionOrderIds = nextOrderIds;
    const orderedVisible = sessionOrderIds.flatMap((sessionId) => {
      const session = sessionById.get(sessionId);
      return session ? [session] : [];
    });

    const openingSessionIds = new Set<string>();
    let openingEpochsChanged = false;
    const observedAtMs = Date.now();
    for (const session of orderedVisible) {
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

    const frozen = Object.freeze([...orderedVisible]);
    setSessions(frozen);
  };

  const markSessionGroupWrite = (sessionId: string) => {
    sessionMembershipRevision += 1;
    sessionGroupWriteRevisionById.set(sessionId, sessionMembershipRevision);
  };

  const commitSessionGroup = (
    sessionIdInput: string,
    groupIdInput: string,
    catalogRevision?: number,
  ): boolean => {
    const sessionId = String(sessionIdInput ?? '').trim();
    const groupId = String(groupIdInput ?? '').trim();
    if (!sessionId || !groupId) return false;
    const currentCatalogRevision = sessionGroupCatalogRevisionById.get(sessionId) ?? 0;
    if (catalogRevision != null && catalogRevision < currentCatalogRevision) return false;
    sessionGroupIdById.set(sessionId, groupId);
    if (catalogRevision != null) {
      sessionGroupCatalogRevisionById.set(sessionId, catalogRevision);
    }
    markSessionGroupWrite(sessionId);
    return true;
  };

  const projectSessionGroups = (
    snapshot: readonly FloetermTerminalSessionInfo[],
  ): TerminalSessionInfo[] => snapshot.flatMap((session) => {
    const pendingMove = pendingSessionGroupMoveById.get(session.id);
    const groupId = pendingMove?.targetGroupId ?? sessionGroupIdById.get(session.id) ?? '';
    return groupId ? [{ ...session, groupId } as TerminalSessionInfo] : [];
  });

  const publishProjectedSessions = (authoritative = false) => {
    const runtimeSnapshot = activeCoordinator?.getSnapshot()
      ?? sessions().map(terminalRuntimeSession);
    applySnapshot(projectSessionGroups(runtimeSnapshot), authoritative);
  };

  const applyListedSessionGroups = (
    listedSessions: readonly TerminalSessionInfo[],
    fence: Readonly<{
      requestSequence: number;
      membershipRevision: number;
      lifecycleRevision: number;
    }> | null,
  ) => {
    if (!fence
      || fence.lifecycleRevision !== lifecycleRevision
      || fence.requestSequence <= latestAppliedSessionListRequestSequence) return;
    latestAppliedSessionListRequestSequence = fence.requestSequence;
    latestAppliedSessionListMembershipRevision = fence.membershipRevision;
    const listedIds = new Set<string>();
    for (const session of listedSessions) {
      const sessionId = String(session.id ?? '').trim();
      const groupId = String(session.groupId ?? '').trim();
      if (!sessionId || !groupId) continue;
      listedIds.add(sessionId);
      if ((sessionGroupWriteRevisionById.get(sessionId) ?? 0) > fence.membershipRevision) continue;
      sessionGroupIdById.set(sessionId, groupId);
    }
    for (const sessionId of [...sessionGroupIdById.keys()]) {
      if (listedIds.has(sessionId)) continue;
      if ((sessionGroupWriteRevisionById.get(sessionId) ?? 0) > fence.membershipRevision) continue;
      sessionGroupIdById.delete(sessionId);
      sessionGroupCatalogRevisionById.delete(sessionId);
    }
    publishProjectedSessions();
  };

  const observeCreatedSession = (session: TerminalSessionInfo) => {
    if (!commitSessionGroup(session.id, session.groupId)) return;
    publishProjectedSessions();
  };

  const applyGroupSnapshot = (nextGroups: readonly TerminalGroup[], revision: number) => {
    if (!Number.isSafeInteger(revision) || revision <= groupSnapshotRevision) return;
    const snapshotIds = new Set(nextGroups.map((group) => group.id));
    const pendingGroups = groups().filter((group) => group.pending && !snapshotIds.has(group.id));
    const ordered = [...nextGroups, ...pendingGroups].sort((left, right) => (
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    ));
    setGroups(Object.freeze(ordered));
    groupSnapshotRevision = revision;
    setGroupRevision((current) => Math.max(current, revision));
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
    pendingSessionGroupMoveById.clear();
    if (preserveSnapshot) untrack(() => publishProjectedSessions());
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
    unsubscribeGroupCatalog?.();
    unsubscribeGroupCatalog = null;
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
    groupRefreshPromise = null;
    groupRefreshRequestSequence += 1;
    latestGroupOperationByKey.clear();
    setCoordinator(null);
    if (!preserveSnapshot) {
      removedSessionIds.clear();
      sessionGroupIdById.clear();
      sessionGroupWriteRevisionById.clear();
      sessionGroupCatalogRevisionById.clear();
      applySnapshot([]);
      setGroups([]);
      groupSnapshotRevision = 0;
      setGroupRevision(0);
      setHydrated(false);
      setError(null);
    }
    setLoading(false);
  };

  const refreshGroups = async (): Promise<void> => {
    if (providerDisposed) return;
    if (groupRefreshPromise) return groupRefreshPromise;
    const client = protocol.session?.();
    const canUseCatalog = protocol.status() === 'connected'
      && Boolean(client)
      && env.env.state === 'ready'
      && canLaunchProcess(env.env()?.permissions);
    if (!canUseCatalog || !client) return;
    const terminalRpc = (rpc as { terminal?: Partial<(typeof rpc)['terminal']> }).terminal;
    if (!terminalRpc || typeof terminalRpc.listGroups !== 'function') return;
    const scheduledLifecycleRevision = lifecycleRevision;
    const requestSequence = ++groupRefreshRequestSequence;
    const request = (async () => {
      const snapshot = await terminalRpc.listGroups!();
      if (providerDisposed
        || scheduledLifecycleRevision !== lifecycleRevision
        || requestSequence !== groupRefreshRequestSequence
        || client !== protocol.session?.()) return;
      applyGroupSnapshot(snapshot.groups, snapshot.revision);
    })();
    groupRefreshPromise = request;
    try {
      await request;
    } finally {
      if (groupRefreshPromise === request) groupRefreshPromise = null;
    }
  };

  const refreshGroupsAtLeast = async (revision: number): Promise<void> => {
    await refreshGroups();
    if (!providerDisposed && groupSnapshotRevision < revision) await refreshGroups();
  };

  const beginGroupOperation = (key: string): number => {
    const sequence = ++nextGroupOperationSequence;
    latestGroupOperationByKey.set(key, sequence);
    return sequence;
  };

  const groupOperationIsCurrent = (key: string, sequence: number): boolean => (
    latestGroupOperationByKey.get(key) === sequence
  );

  const ensureCoordinator = (client: object): TerminalSessionsCoordinator => {
    if (activeCoordinator && activeClient === client) return activeCoordinator;
    disposeConnection(true);
    activeClient = client;
    const coordinatorLifecycleRevision = lifecycleRevision;
    const next = createRedevenTerminalSessionsCoordinator({
      transport: createRedevenTerminalCatalogTransport(rpc, {
        beginListSessions: () => ({
          requestSequence: ++nextSessionListRequestSequence,
          membershipRevision: sessionMembershipRevision,
          lifecycleRevision: coordinatorLifecycleRevision,
        }),
        onSessionsListed: (listedSessions, fence) => {
          if (coordinatorLifecycleRevision !== lifecycleRevision) return;
          applyListedSessionGroups(listedSessions, fence);
        },
        onSessionCreated: (session) => {
          if (coordinatorLifecycleRevision !== lifecycleRevision) return;
          observeCreatedSession(session);
        },
      }),
      logger: buildLogger(),
      // Disable periodic polling; explicit provider refreshes track catalog state transitions.
      pollMs: 0,
    });
    for (const session of sessions()) {
      if (!sessionGroupIdById.has(session.id)) sessionGroupIdById.set(session.id, session.groupId);
      next.upsertSession(terminalRuntimeSession(session));
    }
    activeCoordinator = next;
    setCoordinator(next);
    unsubscribeCoordinator = next.subscribe((snapshot) => {
      if (!coordinatorHydrated && snapshot.length === 0) return;
      applySnapshot(projectSessionGroups(snapshot));
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
    if (terminalRpc && typeof terminalRpc.onGroupCatalogChanged === 'function') {
      unsubscribeGroupCatalog = terminalRpc.onGroupCatalogChanged((event) => {
        if (event.revision <= groupRevision()) return;
        let movedSessionWriteRevision = 0;
        if (event.reason === 'session_moved' && event.sessionId && event.groupId) {
          commitSessionGroup(event.sessionId, event.groupId, event.revision);
          movedSessionWriteRevision = sessionGroupWriteRevisionById.get(event.sessionId) ?? 0;
          publishProjectedSessions();
        }
        setGroupRevision((current) => Math.max(current, event.revision));
        void refreshGroupsAtLeast(event.revision).catch(() => undefined);
        if (event.reason === 'session_moved') {
          void refreshAfterSessionMembershipWrite(movedSessionWriteRevision).catch(() => undefined);
        } else if (event.reason === 'deleted') {
          void refresh().catch(() => undefined);
        }
      });
    }
    setConnectionEpoch((value) => value + 1);
    return next;
  };

  const refresh = async (): Promise<void> => {
    if (providerDisposed) return;
    const client = protocol.session?.();
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
      await Promise.all([current.refresh(), refreshGroups()]);
      if (
        revision !== lifecycleRevision
        || requestSequence !== refreshRequestSequence
        || current !== activeCoordinator
      ) return;
      convergeOutputActivities(current);
      convergeContextAndWork(current);
      flushPendingMetadata(current);
      coordinatorHydrated = true;
      const refreshedSessions = projectSessionGroups(current.getSnapshot());
      applySnapshot(refreshedSessions, true);
      const knownGroupIds = new Set(groups().map((group) => group.id));
      if (refreshedSessions.some((session) => !knownGroupIds.has(session.groupId))) {
        void refreshGroups().catch(() => undefined);
      }
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

  const refreshAfterSessionMembershipWrite = async (writeRevision: number): Promise<void> => {
    const scheduledLifecycleRevision = lifecycleRevision;
    await refresh();
    if (providerDisposed
      || scheduledLifecycleRevision !== lifecycleRevision
      || latestAppliedSessionListMembershipRevision >= writeRevision) return;
    await refresh();
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
          applySnapshot(projectSessionGroups(reconciledCoordinator.getSnapshot()), true);
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
    const client = protocol.session?.();
    if (!client || protocol.status() !== 'connected') return null;
    if (env.env.state !== 'ready' || !canLaunchProcess(env.env()?.permissions)) return null;
    return ensureCoordinator(client);
  };

  const upsertSession = (session: TerminalSessionInfo) => {
    const sessionId = String(session.id ?? '').trim();
    removedSessionIds.delete(sessionId);
    commitSessionGroup(sessionId, session.groupId);
    const current = getCoordinator();
    if (current) {
      current.upsertSession(terminalRuntimeSession(session));
      flushPendingMetadata(current);
      publishProjectedSessions();
      return;
    }
    applySnapshot([...sessions().filter((candidate) => candidate.id !== session.id), session]);
  };

  const removeSession = (sessionId: string) => {
    const normalized = String(sessionId ?? '').trim();
    if (normalized) {
      removedSessionIds.add(normalized);
      pendingSessionGroupMoveById.delete(normalized);
      markSessionGroupWrite(normalized);
      sessionGroupIdById.delete(normalized);
      sessionGroupCatalogRevisionById.delete(normalized);
      pendingForegroundCommands.delete(normalized);
      pendingOutputActivities.delete(normalized);
      latestOutputActivities.delete(normalized);
      latestExecutionContexts.delete(normalized);
      latestWorkStates.delete(normalized);
      pendingExecutionContextConflicts.delete(normalized);
      localPathCapabilityOverrides.delete(normalized);
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
    localPathCapability?: TerminalSessionInfo['localPathCapability'] | null;
  }) => {
    const normalized = String(sessionId ?? '').trim();
    if (!normalized) return;
    const replacesLocalPathCapability = Object.prototype.hasOwnProperty.call(
      patch,
      'localPathCapability',
    );
    if (replacesLocalPathCapability) {
      localPathCapabilityOverrides.set(normalized, patch.localPathCapability ?? null);
    }
    const { localPathCapability: _localPathCapability, ...coordinatorPatch } = patch;
    const current = getCoordinator();
    if (current) {
      current.updateSessionMeta(normalized, coordinatorPatch);
      if (replacesLocalPathCapability) applySnapshot(projectSessionGroups(current.getSnapshot()));
      return;
    }
    applySnapshot(sessions().map((session) => (
      session.id === normalized ? { ...session, ...coordinatorPatch } : session
    )));
  };

  const createGroup = async (request: TerminalGroupCreateRequest): Promise<TerminalGroup> => {
    const scheduledLifecycleRevision = lifecycleRevision;
    const operationSequence = ++nextGroupOperationSequence;
    const pendingId = `pending_group_${operationSequence}`;
    const now = Date.now();
    const pendingGroup: TerminalGroup = {
      id: pendingId,
      name: request.name.trim(),
      defaultWorkingDir: request.defaultWorkingDir.trim(),
      sortOrder: Math.max(0, ...groups().map((group) => group.sortOrder)) + 1,
      createdAtMs: now,
      updatedAtMs: now,
      isDefault: false,
      pending: true,
    };
    setGroups((current) => [...current, pendingGroup]);
    try {
      const result = await rpc.terminal.createGroup(request);
      if (scheduledLifecycleRevision === lifecycleRevision) {
        setGroups((current) => current.filter((group) => group.id !== pendingId));
        if (result.revision >= groupRevision()) {
          setGroups((current) => [...current.filter((group) => group.id !== result.group.id), result.group]);
        }
        setGroupRevision((current) => Math.max(current, result.revision));
        void refreshGroupsAtLeast(result.revision).catch(() => undefined);
      }
      return result.group;
    } catch (cause) {
      if (scheduledLifecycleRevision === lifecycleRevision) {
        setGroups((current) => current.filter((group) => group.id !== pendingId));
      }
      void refreshGroups().catch(() => undefined);
      throw cause;
    }
  };

  const updateGroup = async (request: TerminalGroupUpdateRequest): Promise<TerminalGroup> => {
    const previousGroups = groups();
    const previousRevision = groupRevision();
    const groupId = String(request.groupId ?? '').trim();
    const operationKey = `group:${groupId}`;
    setGroups((current) => current.map((group) => group.id === groupId ? {
      ...group,
      ...(request.name === undefined ? {} : { name: request.name.trim() }),
      ...(request.defaultWorkingDir === undefined ? {} : { defaultWorkingDir: request.defaultWorkingDir.trim() }),
    } : group));
    const scheduledLifecycleRevision = lifecycleRevision;
    const operationSequence = beginGroupOperation(operationKey);
    try {
      const result = await rpc.terminal.updateGroup(request);
      if (scheduledLifecycleRevision === lifecycleRevision && groupOperationIsCurrent(operationKey, operationSequence)) {
        if (result.revision >= groupRevision()) {
          setGroups((current) => current.map((group) => group.id === result.group.id ? result.group : group));
        }
        setGroupRevision((current) => Math.max(current, result.revision));
        void refreshGroupsAtLeast(result.revision).catch(() => undefined);
      }
      return result.group;
    } catch (cause) {
      if (scheduledLifecycleRevision === lifecycleRevision
        && groupOperationIsCurrent(operationKey, operationSequence)
        && groupRevision() === previousRevision) {
        setGroups(previousGroups);
      }
      void refreshGroups().catch(() => undefined);
      throw cause;
    }
  };

  const deleteGroup = async (groupIdInput: string): Promise<TerminalGroupDeleteResponse> => {
    const groupId = String(groupIdInput ?? '').trim();
    const previousGroups = groups();
    const previousSessions = sessions();
    const hiddenSessionIds = previousSessions
      .filter((session) => session.groupId === groupId)
      .map((session) => session.id);
    const previousRevision = groupRevision();
    const operationKey = `group:${groupId}`;
    setGroups((current) => current.filter((group) => group.id !== groupId));
    for (const sessionId of hiddenSessionIds) removedSessionIds.add(sessionId);
    applySnapshot(sessions().filter((session) => session.groupId !== groupId));
    const scheduledLifecycleRevision = lifecycleRevision;
    const operationSequence = beginGroupOperation(operationKey);
    try {
      const result = await rpc.terminal.deleteGroup({ groupId });
      if (scheduledLifecycleRevision === lifecycleRevision && groupOperationIsCurrent(operationKey, operationSequence)) {
        setGroupRevision((current) => Math.max(current, result.revision));
        void refreshGroupsAtLeast(result.revision).catch(() => undefined);
        void refresh().catch(() => undefined);
      }
      return result;
    } catch (cause) {
      if (scheduledLifecycleRevision === lifecycleRevision
        && groupOperationIsCurrent(operationKey, operationSequence)
        && groupRevision() === previousRevision) {
        for (const sessionId of hiddenSessionIds) removedSessionIds.delete(sessionId);
        setGroups(previousGroups);
        applySnapshot(activeCoordinator
          ? projectSessionGroups(activeCoordinator.getSnapshot())
          : [...previousSessions]);
      }
      void refresh().catch(() => undefined);
      throw cause;
    }
  };

  const moveSession = async (sessionIdInput: string, groupIdInput: string): Promise<void> => {
    const sessionId = String(sessionIdInput ?? '').trim();
    const groupId = String(groupIdInput ?? '').trim();
    const previous = sessions().find((session) => session.id === sessionId);
    if (!previous || previous.groupId === groupId) return;
    const operationKey = `session:${sessionId}`;
    const scheduledLifecycleRevision = lifecycleRevision;
    const operationSequence = beginGroupOperation(operationKey);
    const startedCatalogRevision = sessionGroupCatalogRevisionById.get(sessionId) ?? 0;
    pendingSessionGroupMoveById.set(sessionId, {
      operationSequence,
      previousGroupId: previous.groupId,
      targetGroupId: groupId,
      startedCatalogRevision,
    });
    markSessionGroupWrite(sessionId);
    publishProjectedSessions();
    try {
      const result = await rpc.terminal.moveSession({ sessionId, groupId });
      if (scheduledLifecycleRevision !== lifecycleRevision) return;
      const currentOperation = groupOperationIsCurrent(operationKey, operationSequence);
      if (!currentOperation) return;
      commitSessionGroup(result.sessionId, result.groupId, result.revision);
      if (pendingSessionGroupMoveById.get(sessionId)?.operationSequence === operationSequence) {
        pendingSessionGroupMoveById.delete(sessionId);
      }
      publishProjectedSessions();
      setGroupRevision((current) => Math.max(current, result.revision));
      void refreshGroupsAtLeast(result.revision).catch(() => undefined);
      const writeRevision = sessionGroupWriteRevisionById.get(sessionId) ?? sessionMembershipRevision;
      void refreshAfterSessionMembershipWrite(writeRevision).catch(() => undefined);
    } catch (cause) {
      if (scheduledLifecycleRevision !== lifecycleRevision
        || !groupOperationIsCurrent(operationKey, operationSequence)) return;
      const pendingMove = pendingSessionGroupMoveById.get(sessionId);
      if (pendingMove?.operationSequence === operationSequence) {
        pendingSessionGroupMoveById.delete(sessionId);
      }
      const confirmedTarget = (sessionGroupCatalogRevisionById.get(sessionId) ?? 0) > startedCatalogRevision
        && sessionGroupIdById.get(sessionId) === groupId;
      if (confirmedTarget) {
        publishProjectedSessions();
        return;
      }
      commitSessionGroup(sessionId, pendingMove?.previousGroupId ?? previous.groupId);
      publishProjectedSessions();
      const writeRevision = sessionGroupWriteRevisionById.get(sessionId) ?? sessionMembershipRevision;
      void refreshAfterSessionMembershipWrite(writeRevision).catch(() => undefined);
      throw cause;
    }
  };

  const reorderSession = (sessionIdInput: string, beforeSessionIdInput: string | null): void => {
    const sessionId = String(sessionIdInput ?? '').trim();
    const beforeSessionId = String(beforeSessionIdInput ?? '').trim() || null;
    const current = sessions();
    if (!sessionId || !current.some((session) => session.id === sessionId)) return;
    if (beforeSessionId === sessionId) return;

    const nextOrderIds = current.map((session) => session.id).filter((candidate) => candidate !== sessionId);
    const insertIndex = beforeSessionId ? nextOrderIds.indexOf(beforeSessionId) : -1;
    nextOrderIds.splice(insertIndex >= 0 ? insertIndex : nextOrderIds.length, 0, sessionId);
    if (nextOrderIds.every((candidate, index) => candidate === current[index]?.id)) return;

    sessionOrderIds = nextOrderIds;
    applySnapshot([...current]);
  };

  const clearForPermissionDenied = () => {
    disposeConnection(false);
    setStale(false);
    markPermissionDenied(
      protocol.session?.(),
      String(env.env_id() ?? '').trim(),
      env.env()?.permissions,
    );
  };

  const remoteOpeningObservedAtMs = (sessionId: string): number | undefined => {
    remoteOpeningEpochRevision();
    return remoteOpeningObservedAtBySession.get(String(sessionId ?? '').trim());
  };

  const setAgentSessionReader = (readerId: string, sessionId: string | null) => {
    const normalizedReaderId = String(readerId ?? '').trim();
    if (!normalizedReaderId) return;
    const normalizedSessionId = String(sessionId ?? '').trim();
    const previousSessionId = agentReaderSessionById.get(normalizedReaderId) ?? '';
    if (normalizedSessionId) {
      agentReaderSessionById.set(normalizedReaderId, normalizedSessionId);
      agentAttentionTracker.clearUnread(normalizedSessionId);
    } else {
      agentReaderSessionById.delete(normalizedReaderId);
    }
    if (
      previousSessionId
      && previousSessionId !== normalizedSessionId
      && ![...agentReaderSessionById.values()].includes(previousSessionId)
    ) {
      agentAttentionTracker.handleAgentSessionReaderExit(previousSessionId);
    }
  };

  createEffect(() => {
    const currentSessions = sessions();
    const sessionIds = new Set(currentSessions.map((session) => session.id));
    const readerSessionIds = new Set(agentReaderSessionById.values());
    observeTerminalAgentAttentionStates(
      currentSessions,
      agentAttentionTracker,
      (sessionId) => !readerSessionIds.has(sessionId),
    );
    agentAttentionTracker.pruneSessions(sessionIds);
    setAgentUnreadSessionIds((current) => {
      const next = new Set([...current].filter((sessionId) => sessionIds.has(sessionId)));
      return next.size === current.size ? current : next;
    });
    for (const [readerId, sessionId] of agentReaderSessionById) {
      if (!sessionIds.has(sessionId)) agentReaderSessionById.delete(readerId);
    }
  });

  createEffect(() => {
    const envId = String(env.env_id() ?? '').trim();
    const client = protocol.session?.();
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
      disposeConnection(false);
      setStale(false);
      return;
    }

    if (!allowed) {
      disposeConnection(false);
      setStale(false);
      markPermissionDenied(client, envId, permissions);
      return;
    }

    if (serverDenialIsCurrent) {
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

  });

  onCleanup(() => {
    providerDisposed = true;
    agentAttentionTracker.dispose();
    agentReaderSessionById.clear();
    disposeConnection(false);
  });

  const value: TerminalSessionCatalogValue = {
    sessions,
    groups,
    groupRevision,
    hydrated,
    loading,
    stale,
    error,
    permissionDenied,
    connectionEpoch,
    agentUnreadSessionIds,
    setAgentSessionReader,
    remoteOpeningObservedAtMs,
    coordinator,
    getCoordinator,
    refresh,
    refreshGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    moveSession,
    reorderSession,
    upsertSession,
    removeSession,
    updateSessionMeta,
    clearForPermissionDenied,
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
