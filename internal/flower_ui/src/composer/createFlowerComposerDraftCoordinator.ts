import type {
  FlowerAttachmentSource,
  FlowerAttachmentStagingScope,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerStagedAttachment,
} from '../contracts/flowerSurfaceContracts';
import type { FlowerAttachmentController } from '../attachments/createFlowerAttachmentController';

export type FlowerComposerDraftMode =
  | 'ordinary'
  | 'over_limit_editing'
  | 'preparing_long_text_submission';

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
  /** Stable upload-staging target for an unsent new-thread draft. */
  client_request_id?: string;
  prepared_long_text_local_id?: string;
  prepared_long_text_attachment_id?: string;
  capability_revision?: string;
  input_prompt_signature?: string;
  input_drafts?: Readonly<Record<string, Readonly<{
    answer_kind?: 'choice' | 'custom';
    choice_id?: string;
    text?: string;
  }>>>;
  active_input_question_id?: string;
}>;

export type FlowerComposerDraftSnapshot = Readonly<{
  scope_id: string;
  revision: number;
  value: FlowerComposerDraftValue;
  updated_at_unix_ms: number;
}>;

export type FlowerComposerDraftMutationResult = Readonly<{
  kind: 'committed';
  snapshot: FlowerComposerDraftSnapshot;
}>;

export type FlowerComposerDraftSession = Readonly<{
  scopeID: string;
  snapshot: () => FlowerComposerDraftSnapshot;
  subscribe: (listener: (snapshot: FlowerComposerDraftSnapshot) => void) => () => void;
  mutate: (updater: (value: FlowerComposerDraftValue) => FlowerComposerDraftValue) => FlowerComposerDraftMutationResult;
  clear: () => FlowerComposerDraftMutationResult;
}>;

export type FlowerComposerDraftCoordinator = Readonly<{
  open: (scopeID: string) => FlowerComposerDraftSession;
  read: (scopeID: string) => FlowerComposerDraftSnapshot;
  attachmentController: (
    scopeID: string,
    create: () => FlowerAttachmentController,
  ) => FlowerAttachmentController;
  attachmentStagingScope: (scopeID: string) => FlowerAttachmentStagingScope | null;
  ensureAttachmentStagingScope: (
    scopeID: string,
    create: () => Promise<FlowerAttachmentStagingScope>,
    release: (scope: FlowerAttachmentStagingScope) => Promise<void>,
  ) => Promise<FlowerAttachmentStagingScope>;
  releaseAttachmentStagingScope: (scopeID: string) => void;
  moveScope: (fromScopeID: string, toScopeID: string) => FlowerComposerDraftSnapshot;
  dispose: () => void;
}>;

export type FlowerComposerDraftCoordinatorOptions = Readonly<{
  now?: () => number;
}>;

type DraftCell = {
  snapshot: FlowerComposerDraftSnapshot;
  listeners: Set<(snapshot: FlowerComposerDraftSnapshot) => void>;
};

type ScopeHandle = {
  cell: DraftCell;
  stagingScope: FlowerAttachmentStagingScope | null;
  stagingScopeOperation: StagingScopeOperation | null;
  releaseStagingScope: ((scope: FlowerAttachmentStagingScope) => Promise<void>) | null;
  attachmentController: FlowerAttachmentController | null;
};

type StagingScopeOperation = {
  owner: ScopeHandle | null;
  promise: Promise<FlowerAttachmentStagingScope>;
  release: (scope: FlowerAttachmentStagingScope) => Promise<void>;
};

const FLOWER_ATTACHMENT_STAGING_EXPIRY_SKEW_MS = 5_000;

const emptyDraft = (): FlowerComposerDraftValue => ({
  text: '',
  attachments: [],
  references: [],
  mode: 'ordinary',
});

export function createFlowerComposerDraftCoordinator(
  options: FlowerComposerDraftCoordinatorOptions = {},
): FlowerComposerDraftCoordinator {
  const states = new Map<string, ScopeHandle>();
  const now = options.now ?? Date.now;
  let disposed = false;

  const assertActive = () => {
    if (disposed) throw new Error('Flower composer draft coordinator is disposed.');
  };
  const normalizedScope = (scopeID: string) => scopeID.trim() || '__new_thread__';
  const stateFor = (rawScopeID: string): ScopeHandle => {
    assertActive();
    const scopeID = normalizedScope(rawScopeID);
    const existing = states.get(scopeID);
    if (existing) return existing;
    const created: ScopeHandle = {
      cell: {
        snapshot: {
          scope_id: scopeID,
          revision: 0,
          value: emptyDraft(),
          updated_at_unix_ms: now(),
        },
        listeners: new Set(),
      },
      stagingScope: null,
      stagingScopeOperation: null,
      releaseStagingScope: null,
      attachmentController: null,
    };
    states.set(scopeID, created);
    return created;
  };
  const emit = (cell: DraftCell) => {
    for (const listener of cell.listeners) listener(cell.snapshot);
  };
  const releaseStagingScope = (handle: ScopeHandle) => {
    const operation = handle.stagingScopeOperation;
    const scope = handle.stagingScope;
    const release = handle.releaseStagingScope;
    handle.stagingScopeOperation = null;
    handle.stagingScope = null;
    handle.releaseStagingScope = null;
    handle.attachmentController?.setStagingScope(null);
    if (operation?.owner === handle) operation.owner = null;
    if (scope) {
      void release?.(scope).catch(() => undefined);
    }
  };
  const activeStagingScope = (handle: ScopeHandle): FlowerAttachmentStagingScope | null => {
    const scope = handle.stagingScope;
    if (!scope) return null;
    if (scope.expires_at_unix_ms > now() + FLOWER_ATTACHMENT_STAGING_EXPIRY_SKEW_MS) return scope;
    releaseStagingScope(handle);
    return null;
  };
  const replace = (cell: DraftCell, value: FlowerComposerDraftValue): FlowerComposerDraftSnapshot => {
    cell.snapshot = {
      ...cell.snapshot,
      revision: cell.snapshot.revision + 1,
      value,
      updated_at_unix_ms: now(),
    };
    emit(cell);
    return cell.snapshot;
  };
  const open = (rawScopeID: string): FlowerComposerDraftSession => {
    const scopeID = normalizedScope(rawScopeID);
    const handle = stateFor(scopeID);
    return {
      scopeID,
      snapshot: () => {
        assertActive();
        return handle.cell.snapshot;
      },
      subscribe: (listener) => {
        assertActive();
        handle.cell.listeners.add(listener);
        listener(handle.cell.snapshot);
        return () => handle.cell.listeners.delete(listener);
      },
      mutate: (updater) => {
        assertActive();
        const cell = handle.cell;
        const value = updater(cell.snapshot.value);
        return { kind: 'committed', snapshot: value === cell.snapshot.value ? cell.snapshot : replace(cell, value) };
      },
      clear: () => {
        assertActive();
        return { kind: 'committed', snapshot: replace(handle.cell, emptyDraft()) };
      },
    };
  };

  return {
    open,
    read: (scopeID) => stateFor(scopeID).cell.snapshot,
    attachmentController: (scopeID, create) => {
      const handle = stateFor(scopeID);
      handle.attachmentController ??= create();
      const stagingScope = activeStagingScope(handle);
      if (handle.attachmentController.snapshot().staging_scope !== stagingScope) {
        handle.attachmentController.setStagingScope(stagingScope);
      }
      return handle.attachmentController;
    },
    attachmentStagingScope: (scopeID) => activeStagingScope(stateFor(scopeID)),
    ensureAttachmentStagingScope: (rawScopeID, create, release) => {
      const handle = stateFor(rawScopeID);
      const active = activeStagingScope(handle);
      if (active) return Promise.resolve(active);
      if (handle.stagingScopeOperation) return handle.stagingScopeOperation.promise;
      const operation: StagingScopeOperation = {
        owner: handle,
        promise: Promise.resolve(null as never),
        release,
      };
      const creation = create().then((scope) => {
        const owner = operation.owner;
        if (disposed || !owner || owner.stagingScopeOperation !== operation) {
          void release(scope).catch(() => undefined);
          throw new Error(disposed
            ? 'Flower composer draft coordinator is disposed.'
            : 'Flower attachment staging scope is no longer active.');
        }
        owner.stagingScope = scope;
        owner.releaseStagingScope = release;
        owner.attachmentController?.setStagingScope(scope);
        return scope;
      }).finally(() => {
        const owner = operation.owner;
        if (owner?.stagingScopeOperation === operation) owner.stagingScopeOperation = null;
      });
      operation.promise = creation;
      handle.stagingScopeOperation = operation;
      return creation;
    },
    releaseAttachmentStagingScope: (scopeID) => releaseStagingScope(stateFor(scopeID)),
    moveScope: (rawFromScopeID, rawToScopeID) => {
      assertActive();
      const fromScopeID = normalizedScope(rawFromScopeID);
      const toScopeID = normalizedScope(rawToScopeID);
      if (fromScopeID === toScopeID) return stateFor(fromScopeID).cell.snapshot;
      const from = stateFor(fromScopeID);
      const target = stateFor(toScopeID);
      const sourceSnapshot = from.cell.snapshot;
      if (
        target.stagingScope !== from.stagingScope
        || target.stagingScopeOperation !== from.stagingScopeOperation
      ) releaseStagingScope(target);
      if (target.attachmentController !== from.attachmentController) {
        target.attachmentController?.dispose();
      }
      target.stagingScope = from.stagingScope;
      target.stagingScopeOperation = from.stagingScopeOperation;
      if (target.stagingScopeOperation) target.stagingScopeOperation.owner = target;
      target.releaseStagingScope = from.releaseStagingScope;
      target.attachmentController = from.attachmentController;
      target.cell.snapshot = {
        ...sourceSnapshot,
        scope_id: toScopeID,
        revision: Math.max(sourceSnapshot.revision, target.cell.snapshot.revision) + 1,
        updated_at_unix_ms: now(),
      };
      from.stagingScope = null;
      from.stagingScopeOperation = null;
      from.releaseStagingScope = null;
      from.attachmentController = null;
      from.cell.snapshot = {
        scope_id: fromScopeID,
        revision: sourceSnapshot.revision + 1,
        value: emptyDraft(),
        updated_at_unix_ms: now(),
      };
      emit(target.cell);
      emit(from.cell);
      return target.cell.snapshot;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const state of new Set(states.values())) {
        releaseStagingScope(state);
        state.attachmentController?.dispose();
        state.attachmentController = null;
        state.cell.listeners.clear();
      }
      states.clear();
    },
  };
}
