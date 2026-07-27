import type {
  FlowerAttachmentSource,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerStagedAttachment,
} from '../contracts/flowerSurfaceContracts';

export type FlowerComposerDraftMode =
  | 'ordinary'
  | 'over_limit_editing'
  | 'preparing_long_text_submission'
  | 'admission_in_flight';

export type FlowerComposerDraftAttachment = Readonly<{
  local_id: string;
  source: FlowerAttachmentSource;
  name: string;
  mime_type: string;
  size_bytes: number;
  upload_request_id: string;
  attempt_state: string;
  staged?: FlowerStagedAttachment;
}>;

export type FlowerComposerDraftReferenceKind = 'file' | 'directory';

export type FlowerComposerDraftReference = Readonly<{
  local_id: string;
  kind: FlowerComposerDraftReferenceKind;
  path: string;
  label: string;
}>;

export type FlowerComposerDraftValue = Readonly<{
  text: string;
  attachments: readonly FlowerComposerDraftAttachment[];
  references: readonly FlowerComposerDraftReference[];
  mode: FlowerComposerDraftMode;
  model_id?: string;
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection;
  working_dir?: string;
  proposed_turn_id?: string;
  admission_started?: boolean;
  prepared_long_text_local_id?: string;
  prepared_long_text_attachment_id?: string;
  target_thread_id?: string;
  capability_revision?: string;
}>;

export type FlowerComposerDraftSnapshot = Readonly<{
  scope_id: string;
  revision: number;
  value: FlowerComposerDraftValue;
  updated_at_unix_ms: number;
  lease?: FlowerComposerDraftLease;
}>;

export type FlowerComposerDraftLease = Readonly<{
  lease_id: string;
  scope_id: string;
  holder_id: string;
  acquired_revision: number;
  expires_at_unix_ms: number;
}>;

export type FlowerComposerDraftLeaseState =
  | Readonly<{ kind: 'lease_available' }>
  | Readonly<{ kind: 'lease_acquiring' }>
  | Readonly<{
    kind: 'lease_owned';
    lease: FlowerComposerDraftLease;
    persistence?: 'store_unavailable';
    unsaved?: boolean;
  }>
  | Readonly<{ kind: 'lease_conflict'; holder_id: string; expires_at_unix_ms: number }>
  | Readonly<{ kind: 'store_unavailable'; unsaved: boolean }>;

export type FlowerComposerDraftMutationResult =
  | Readonly<{ kind: 'committed'; snapshot: FlowerComposerDraftSnapshot }>
  | Readonly<{ kind: 'revision_conflict'; snapshot: FlowerComposerDraftSnapshot }>
  | Readonly<{ kind: 'lease_lost'; snapshot: FlowerComposerDraftSnapshot; unsaved?: boolean }>
  | Readonly<{ kind: 'store_unavailable'; snapshot: FlowerComposerDraftSnapshot; unsaved: true }>;

export type FlowerComposerDraftSession = Readonly<{
  scopeID: string;
  holderID: string;
  snapshot: () => FlowerComposerDraftSnapshot;
  leaseState: () => FlowerComposerDraftLeaseState;
  subscribe: (listener: (snapshot: FlowerComposerDraftSnapshot, lease: FlowerComposerDraftLeaseState) => void) => () => void;
  tryAcquire: () => FlowerComposerDraftLeaseState;
  acquire: () => Promise<FlowerComposerDraftLeaseState>;
  takeOver: () => Promise<FlowerComposerDraftLeaseState>;
  renew: () => Promise<FlowerComposerDraftLeaseState>;
  mutate: (
    expectedRevision: number,
    updater: (value: FlowerComposerDraftValue) => FlowerComposerDraftValue,
  ) => Promise<FlowerComposerDraftMutationResult>;
  release: () => Promise<void>;
}>;

export type FlowerComposerDraftCoordinator = Readonly<{
  open: (scopeID: string, holderID: string) => FlowerComposerDraftSession;
  read: (scopeID: string) => FlowerComposerDraftSnapshot;
}>;

export type FlowerComposerDraftCoordinatorOptions = Readonly<{
  now?: () => number;
  createLeaseID?: () => string;
  leaseDurationMS?: number;
  initialDraft?: (scopeID: string) => FlowerComposerDraftValue;
  persistence?: FlowerComposerDraftPersistence;
}>;

export type FlowerComposerDraftPersistence = Readonly<{
  load: (scopeID: string) => Promise<FlowerComposerDraftSnapshot & Readonly<{
    lease?: FlowerComposerDraftLease;
  }>>;
  acquire: (scopeID: string, holderID: string, takeOver: boolean) => Promise<Readonly<{
    state: 'owned' | 'conflict' | 'lost';
    snapshot: FlowerComposerDraftSnapshot;
    lease?: FlowerComposerDraftLease;
    holderID?: string;
  }>>;
  renew: (scopeID: string, holderID: string, leaseID: string) => Promise<Readonly<{
    state: 'owned' | 'lost';
    snapshot: FlowerComposerDraftSnapshot;
    lease?: FlowerComposerDraftLease;
  }>>;
  mutate: (
    scopeID: string,
    holderID: string,
    leaseID: string,
    expectedRevision: number,
    value: FlowerComposerDraftValue,
  ) => Promise<FlowerComposerDraftMutationResult>;
  release: (scopeID: string, holderID: string, leaseID: string) => Promise<void>;
}>;

type ScopeState = {
  snapshot: FlowerComposerDraftSnapshot;
  remoteSnapshot: FlowerComposerDraftSnapshot;
  lease: FlowerComposerDraftLease | null;
  conflict: Readonly<{ holder_id: string; expires_at_unix_ms: number }> | null;
  listeners: Set<() => void>;
  loading?: Promise<void>;
  acquiring?: Promise<FlowerComposerDraftLeaseState>;
  storeUnavailable: boolean;
  pollTimer?: ReturnType<typeof setInterval>;
  mutationTail: Promise<void>;
  pendingMutations: Array<Readonly<{
    id: number;
    updater: (value: FlowerComposerDraftValue) => FlowerComposerDraftValue;
  }>>;
  mutationSequence: number;
};

const emptyDraft = (): FlowerComposerDraftValue => ({
  text: '',
  attachments: [],
  references: [],
  mode: 'ordinary',
});

export function createFlowerComposerDraftCoordinator(
  options: FlowerComposerDraftCoordinatorOptions = {},
): FlowerComposerDraftCoordinator {
  const states = new Map<string, ScopeState>();
  const now = options.now ?? Date.now;
  const persistence = options.persistence;
  const leaseDurationMS = Math.max(1_000, Math.floor(options.leaseDurationMS ?? 15_000));
  let leaseSequence = 0;

  const normalizedScope = (scopeID: string) => scopeID.trim() || '__new_thread__';
  const emit = (state: ScopeState) => {
    for (const listener of state.listeners) listener();
  };
  const projectPendingMutations = (state: ScopeState): void => {
    let value = state.remoteSnapshot.value;
    for (const mutation of state.pendingMutations) value = mutation.updater(value);
    state.snapshot = {
      ...state.remoteSnapshot,
      value,
      ...(state.pendingMutations.length > 0 ? { updated_at_unix_ms: now() } : {}),
    };
  };
  const adoptRemoteSnapshot = (state: ScopeState, snapshot: FlowerComposerDraftSnapshot): boolean => {
    if (snapshot.revision < state.remoteSnapshot.revision) return false;
    state.remoteSnapshot = {
      scope_id: snapshot.scope_id || state.remoteSnapshot.scope_id,
      revision: snapshot.revision,
      value: snapshot.value,
      updated_at_unix_ms: snapshot.updated_at_unix_ms,
      ...(snapshot.lease ? { lease: snapshot.lease } : {}),
    };
    projectPendingMutations(state);
    return true;
  };
  const stateFor = (rawScopeID: string): ScopeState => {
    const scopeID = normalizedScope(rawScopeID);
    const existing = states.get(scopeID);
    if (existing) return existing;
    const initialSnapshot: FlowerComposerDraftSnapshot = {
      scope_id: scopeID,
      revision: 0,
      value: options.initialDraft?.(scopeID) ?? emptyDraft(),
      updated_at_unix_ms: now(),
    };
    const created: ScopeState = {
      snapshot: initialSnapshot,
      remoteSnapshot: initialSnapshot,
      lease: null,
      conflict: null,
      listeners: new Set(),
      storeUnavailable: false,
      mutationTail: Promise.resolve(),
      pendingMutations: [],
      mutationSequence: 0,
    };
    states.set(scopeID, created);
    if (persistence) {
      const loading = persistence.load(scopeID).then((loaded) => {
        adoptRemoteSnapshot(created, loaded);
        created.lease = loaded.lease ?? null;
        created.storeUnavailable = false;
        emit(created);
      }).catch(() => {
        created.storeUnavailable = true;
        emit(created);
      }).finally(() => {
        if (created.loading === loading) created.loading = undefined;
      });
      created.loading = loading;
    }
    return created;
  };
  const activeLease = (state: ScopeState): FlowerComposerDraftLease | null => {
    if (state.lease && state.lease.expires_at_unix_ms <= now()) state.lease = null;
    return state.lease;
  };
  const leaseStateFor = (state: ScopeState, holderID: string): FlowerComposerDraftLeaseState => {
    const lease = activeLease(state);
    if (!lease) {
      if (state.conflict) return { kind: 'lease_conflict', ...state.conflict };
      return state.storeUnavailable
        ? { kind: 'store_unavailable', unsaved: state.pendingMutations.length > 0 }
        : { kind: 'lease_available' };
    }
    if (lease.holder_id === holderID) {
      return {
        kind: 'lease_owned',
        lease,
        ...(state.storeUnavailable ? {
          persistence: 'store_unavailable' as const,
          unsaved: state.pendingMutations.length > 0,
        } : {}),
      };
    }
    return {
      kind: 'lease_conflict',
      holder_id: lease.holder_id,
      expires_at_unix_ms: lease.expires_at_unix_ms,
    };
  };
  const grantLease = (state: ScopeState, holderID: string): FlowerComposerDraftLeaseState => {
    const scopeID = state.snapshot.scope_id;
    const lease: FlowerComposerDraftLease = {
      lease_id: options.createLeaseID?.() ?? `flower_draft_lease_${now()}_${++leaseSequence}`,
      scope_id: scopeID,
      holder_id: holderID,
      acquired_revision: state.snapshot.revision,
      expires_at_unix_ms: now() + leaseDurationMS,
    };
    state.lease = lease;
    state.conflict = null;
    emit(state);
    return { kind: 'lease_owned', lease };
  };

  return {
    read: (scopeID) => stateFor(scopeID).snapshot,
    open: (rawScopeID, rawHolderID) => {
      const scopeID = normalizedScope(rawScopeID);
      const holderID = rawHolderID.trim();
      if (!holderID) throw new Error('Flower composer draft holder id is required.');
      const state = stateFor(scopeID);
      let acquiring = false;
      const currentLeaseState = (): FlowerComposerDraftLeaseState => (
        acquiring || state.loading ? { kind: 'lease_acquiring' } : leaseStateFor(state, holderID)
      );
      const recoverStore = async (): Promise<boolean> => {
        if (!persistence || !state.storeUnavailable) return true;
        const lease = activeLease(state);
        if (lease?.holder_id === holderID) return true;
        try {
          const loaded = await persistence.load(scopeID);
          adoptRemoteSnapshot(state, loaded);
          state.lease = loaded.lease ?? null;
          state.storeUnavailable = false;
          emit(state);
          return true;
        } catch {
          state.storeUnavailable = true;
          emit(state);
          return false;
        }
      };
      const acquire = async (): Promise<FlowerComposerDraftLeaseState> => {
        if (state.loading) await state.loading;
        const current = activeLease(state);
        if (current?.holder_id === holderID) return leaseStateFor(state, holderID);
        if (current) return leaseStateFor(state, holderID);
        if (!await recoverStore()) return { kind: 'store_unavailable', unsaved: state.pendingMutations.length > 0 };
        if (persistence) {
          if (state.acquiring) return state.acquiring;
          acquiring = true;
          emit(state);
          state.acquiring = persistence.acquire(scopeID, holderID, false).then((result) => {
            adoptRemoteSnapshot(state, result.snapshot);
            state.lease = result.lease ?? null;
            state.storeUnavailable = false;
            if (result.state === 'owned' && result.lease) {
              state.conflict = null;
              return { kind: 'lease_owned', lease: result.lease } as const;
            }
            const conflict = {
              kind: 'lease_conflict',
              holder_id: result.holderID ?? result.lease?.holder_id ?? 'unknown_holder',
              expires_at_unix_ms: result.lease?.expires_at_unix_ms ?? 0,
            } as const;
            state.conflict = {
              holder_id: conflict.holder_id,
              expires_at_unix_ms: conflict.expires_at_unix_ms,
            };
            return conflict;
          }).catch(() => {
            state.storeUnavailable = true;
            return { kind: 'store_unavailable', unsaved: state.pendingMutations.length > 0 } as const;
          }).finally(() => {
            acquiring = false;
            state.acquiring = undefined;
            emit(state);
          });
          return state.acquiring;
        }
        acquiring = true;
        emit(state);
        await Promise.resolve();
        acquiring = false;
        if (activeLease(state)) {
          emit(state);
          return leaseStateFor(state, holderID);
        }
        return grantLease(state, holderID);
      };
      const enqueueSerialized = <Result>(operation: () => Promise<Result>): Promise<Result> => {
        const result = state.mutationTail.then(operation, operation);
        state.mutationTail = result.then(() => undefined, () => undefined);
        return result;
      };
      const flushPendingMutations = async (targetID?: number): Promise<FlowerComposerDraftMutationResult> => {
        const lease = activeLease(state);
        if (!lease || lease.holder_id !== holderID) {
          return {
            kind: 'lease_lost',
            snapshot: state.snapshot,
            ...(state.pendingMutations.length > 0 ? { unsaved: true } : {}),
          };
        }
        if (!persistence) {
          while (state.pendingMutations.length > 0) {
            const pending = state.pendingMutations[0]!;
            state.remoteSnapshot = {
              ...state.remoteSnapshot,
              revision: state.remoteSnapshot.revision + 1,
              value: pending.updater(state.remoteSnapshot.value),
              updated_at_unix_ms: now(),
            };
            state.pendingMutations.shift();
            projectPendingMutations(state);
            state.lease = { ...lease, expires_at_unix_ms: now() + leaseDurationMS };
            emit(state);
            if (targetID === pending.id) return { kind: 'committed', snapshot: state.snapshot };
          }
          return { kind: 'committed', snapshot: state.snapshot };
        }
        while (state.pendingMutations.length > 0) {
          const pending = state.pendingMutations[0]!;
          let conflicts = 0;
          for (;;) {
            let result: FlowerComposerDraftMutationResult;
            try {
              result = await persistence.mutate(
                scopeID,
                holderID,
                lease.lease_id,
                state.remoteSnapshot.revision,
                pending.updater(state.remoteSnapshot.value),
              );
            } catch {
              state.storeUnavailable = true;
              projectPendingMutations(state);
              emit(state);
              return { kind: 'store_unavailable', snapshot: state.snapshot, unsaved: true };
            }
            state.storeUnavailable = false;
            adoptRemoteSnapshot(state, result.snapshot);
            if (result.snapshot.lease) state.lease = result.snapshot.lease;
            if (result.kind === 'store_unavailable') {
              state.storeUnavailable = true;
              projectPendingMutations(state);
              emit(state);
              return { kind: 'store_unavailable', snapshot: state.snapshot, unsaved: true };
            }
            if (result.kind === 'committed') {
              state.pendingMutations.shift();
              projectPendingMutations(state);
              emit(state);
              if (targetID === pending.id) return { kind: 'committed', snapshot: state.snapshot };
              break;
            }
            if (result.kind === 'revision_conflict' && conflicts === 0) {
              conflicts += 1;
              continue;
            }
            if (result.kind === 'lease_lost') state.lease = null;
            projectPendingMutations(state);
            emit(state);
            return result.kind === 'lease_lost'
              ? { kind: 'lease_lost', snapshot: state.snapshot, unsaved: true }
              : { ...result, snapshot: state.snapshot };
          }
        }
        return { kind: 'committed', snapshot: state.snapshot };
      };
      return {
        scopeID,
        holderID,
        snapshot: () => state.snapshot,
        leaseState: currentLeaseState,
        subscribe: (listener) => {
          const wrapped = () => listener(state.snapshot, currentLeaseState());
          state.listeners.add(wrapped);
          wrapped();
          if (persistence && !state.pollTimer) {
            state.pollTimer = setInterval(() => {
              const lease = activeLease(state);
              if (lease?.holder_id === holderID || state.loading || acquiring) return;
              void persistence.load(scopeID).then((loaded) => {
                adoptRemoteSnapshot(state, loaded);
                state.lease = loaded.lease ?? null;
                state.storeUnavailable = false;
                emit(state);
              }).catch(() => {
                state.storeUnavailable = true;
                emit(state);
              });
            }, 2_000);
          }
          return () => {
            state.listeners.delete(wrapped);
            if (state.listeners.size === 0 && state.pollTimer) {
              clearInterval(state.pollTimer);
              state.pollTimer = undefined;
            }
          };
        },
        tryAcquire: () => {
          if (state.conflict) return leaseStateFor(state, holderID);
          const current = activeLease(state);
          if (current?.holder_id === holderID) return leaseStateFor(state, holderID);
          if (current) return leaseStateFor(state, holderID);
          if (persistence) {
            void acquire();
            return { kind: 'lease_acquiring' };
          }
          return grantLease(state, holderID);
        },
        acquire,
        takeOver: async () => {
          if (state.loading) await state.loading;
          if (!await recoverStore()) return { kind: 'store_unavailable', unsaved: state.pendingMutations.length > 0 };
          if (persistence) {
            acquiring = true;
            emit(state);
            try {
              const result = await persistence.acquire(scopeID, holderID, true);
              adoptRemoteSnapshot(state, result.snapshot);
              state.lease = result.lease ?? null;
              state.storeUnavailable = false;
              if (result.state === 'owned' && result.lease) {
                state.conflict = null;
                return { kind: 'lease_owned', lease: result.lease };
              }
              const conflict = {
                kind: 'lease_conflict',
                holder_id: result.holderID ?? result.lease?.holder_id ?? 'admission_reconciliation',
                expires_at_unix_ms: result.lease?.expires_at_unix_ms ?? 0,
              } as const;
              state.conflict = {
                holder_id: conflict.holder_id,
                expires_at_unix_ms: conflict.expires_at_unix_ms,
              };
              return conflict;
            } catch {
              state.storeUnavailable = true;
              return { kind: 'store_unavailable', unsaved: state.pendingMutations.length > 0 };
            } finally {
              acquiring = false;
              emit(state);
            }
          }
          const current = activeLease(state);
          if (current?.holder_id !== holderID
            && (state.snapshot.value.mode === 'preparing_long_text_submission'
              || state.snapshot.value.mode === 'admission_in_flight')) {
            return leaseStateFor(state, holderID);
          }
          const expectedLeaseID = current?.lease_id ?? '';
          const expectedRevision = state.snapshot.revision;
          acquiring = true;
          emit(state);
          await Promise.resolve();
          acquiring = false;
          const latest = activeLease(state);
          if (
            state.snapshot.revision !== expectedRevision
            || (latest?.lease_id ?? '') !== expectedLeaseID
            || (latest?.holder_id !== holderID
              && (state.snapshot.value.mode === 'preparing_long_text_submission'
                || state.snapshot.value.mode === 'admission_in_flight'))
          ) {
            emit(state);
            return leaseStateFor(state, holderID);
          }
          if (latest?.holder_id === holderID) return { kind: 'lease_owned', lease: latest };
          return grantLease(state, holderID);
        },
        renew: () => enqueueSerialized(async () => {
          const lease = activeLease(state);
          if (!lease || lease.holder_id !== holderID) return leaseStateFor(state, holderID);
          if (persistence) {
            try {
              const result = await persistence.renew(scopeID, holderID, lease.lease_id);
              adoptRemoteSnapshot(state, result.snapshot);
              state.storeUnavailable = false;
              if (result.state !== 'owned' || !result.lease) {
                state.lease = null;
                emit(state);
                return leaseStateFor(state, holderID);
              }
              state.lease = result.lease;
              state.conflict = null;
              emit(state);
              if (state.pendingMutations.length > 0) await flushPendingMutations();
              return leaseStateFor(state, holderID);
            } catch {
              state.storeUnavailable = true;
              emit(state);
              return leaseStateFor(state, holderID);
            }
          }
          state.lease = { ...lease, expires_at_unix_ms: now() + leaseDurationMS };
          emit(state);
          return { kind: 'lease_owned', lease: state.lease };
        }),
        mutate: (expectedRevision, updater) => {
          const lease = activeLease(state);
          if (!lease || lease.holder_id !== holderID) {
            return Promise.resolve({ kind: 'lease_lost', snapshot: state.snapshot } as const);
          }
          if (expectedRevision !== state.remoteSnapshot.revision) {
            return Promise.resolve({ kind: 'revision_conflict', snapshot: state.snapshot } as const);
          }
          const pending = { id: ++state.mutationSequence, updater };
          state.pendingMutations.push(pending);
          projectPendingMutations(state);
          emit(state);
          return enqueueSerialized(() => flushPendingMutations(pending.id));
        },
        release: async () => {
          const lease = activeLease(state);
          if (lease?.holder_id !== holderID) return;
          if (persistence) {
            try {
              await persistence.release(scopeID, holderID, lease.lease_id);
            } finally {
              state.lease = null;
              state.conflict = null;
              emit(state);
            }
            return;
          }
          state.lease = null;
          emit(state);
        },
      };
    },
  };
}
