import type { ReferenceSnapshot, ThreadReferenceSnapshot } from '../contextActionWire';
import type {
  FlowerAttachmentSource,
  FlowerAttachmentStagingScope,
  FlowerPermissionType,
  FlowerReasoningSelection,
  FlowerStagedAttachment,
  FlowerQueuedTurnAttachment,
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
  admitted?: FlowerQueuedTurnAttachment;
}>;

export type FlowerComposerDraftReferenceKind = 'file' | 'directory';

export type FlowerPageContextSnapshot = Readonly<{
  label: string;
  title: string;
  content: string;
}>;

export type FlowerComposerDraftReference = Readonly<{
  local_id: string;
  kind: FlowerComposerDraftReferenceKind;
  path: string;
  label: string;
}> | (FlowerPageContextSnapshot & Readonly<{ local_id: string; kind: 'page_context' }>) | Readonly<{ local_id: string; kind: 'thread'; label: string; thread: ThreadReferenceSnapshot }> | Readonly<{ local_id: string; kind: 'snapshot'; label: string; snapshot: ReferenceSnapshot }>;

export type FlowerComposerDraftValue = Readonly<{
  text: string;
  goal_edit?: Readonly<{ text: string; version: number; error?: string }>;
  /** Goal command input is independent from the preserved ordinary draft. */
  goal_command?: Readonly<{ text: string; error?: string }>;
  omit_embedded_context?: boolean;
  attachments: readonly FlowerComposerDraftAttachment[];
  references: readonly FlowerComposerDraftReference[];
  /** Prevent edit-time recapture until an explicit companion opening or New action. */
  page_context_captured?: boolean;
  mode: FlowerComposerDraftMode;
  model_id?: string;
  permission_type_override?: FlowerPermissionType;
  /** Explicit new-thread choice only; resolved defaults and request snapshots never write here. */
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
  /** Tracks text changes independently from references, settings, and uploads. */
  text_revision: number;
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
  exportForRestart: () => readonly FlowerComposerRestartDraft[];
  restoreAfterRestart: (drafts: readonly FlowerComposerRestartDraft[]) => void;
  resumeAfterCanceledRestart: () => void;
  open: (scopeID: string) => FlowerComposerDraftSession;
  read: (scopeID: string) => FlowerComposerDraftSnapshot;
  scopes: () => readonly string[];
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
  updateAttachmentStagingScope: (scopeID: string, previous: FlowerAttachmentStagingScope, next: FlowerAttachmentStagingScope) => void;
  releaseAttachmentStagingScope: (scopeID: string) => void;
  moveScope: (fromScopeID: string, toScopeID: string) => FlowerComposerDraftSnapshot;
  dispose: () => void;
}>;

export type FlowerComposerRestartDraft = Readonly<{
  scope_id: string;
  value: FlowerComposerDraftValue;
  files: readonly Readonly<{ local_id: string; file: File }>[];
}>;

export type FlowerComposerDraftCoordinatorOptions = Readonly<{
  now?: () => number;
}>;

type DraftCell = {
  snapshot: FlowerComposerDraftSnapshot;
  listeners: Set<(snapshot: FlowerComposerDraftSnapshot) => void>;
};

type ScopeHandle = {
  restartFiles?: readonly Readonly<{ local_id: string; file: File }>[];
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
          text_revision: 0,
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
      text_revision: cell.snapshot.text_revision + (cell.snapshot.value.text === value.text ? 0 : 1),
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
    exportForRestart: () => {
      assertActive();
      const drafts: FlowerComposerRestartDraft[] = [];
      for (const [scopeID, handle] of states) {
        handle.attachmentController?.setSuspended(true);
        const files = handle.attachmentController?.localFiles() ?? handle.restartFiles ?? [];
        const value = handle.cell.snapshot.value;
        if (value.attachments.some(attachment => attachment.staged && !files.some(file => file.local_id === attachment.local_id))) {
          throw new Error('An attachment must be available locally before restarting the Runtime.');
        }
        // Copy user intent explicitly. Staging capabilities, model capability
        // revisions and previously prepared submissions belong to the old session.
        drafts.push({ scope_id: scopeID, files, value: {
          text: value.text, goal_edit: value.goal_edit, goal_command: value.goal_command, mode: 'ordinary',
          omit_embedded_context: value.omit_embedded_context,
          references: value.references.map(reference => ({ ...reference })),
          page_context_captured: value.page_context_captured,
          attachments: value.attachments.map(attachment => ({
            local_id: attachment.local_id, source: attachment.source,
            name: attachment.name, mime_type: attachment.mime_type, size_bytes: attachment.size_bytes,
            upload_request_id: `flower_attachment_request_${crypto.randomUUID()}`,
            attempt_state: attachment.admitted ? 'staged_ready' : files.some(file => file.local_id === attachment.local_id) ? 'queued' : 'reselect_required',
            ...(attachment.admitted ? { admitted: attachment.admitted } : {}),
          })),
          model_id: value.model_id, permission_type_override: value.permission_type_override,
          reasoning_selection: value.reasoning_selection, working_dir: value.working_dir,
          input_drafts: value.input_drafts && Object.fromEntries(Object.entries(value.input_drafts)
            .map(([id, answer]) => [id, { ...answer }])),
          active_input_question_id: value.active_input_question_id,
        } });
      }
      return drafts;
    },
    restoreAfterRestart: (drafts) => {
      assertActive();
      if (states.size > 0) throw new Error('Restore drafts before mounting Flower surfaces.');
      for (const draft of drafts) {
        const handle = stateFor(draft.scope_id);
        handle.restartFiles = draft.files;
        replace(handle.cell, draft.value);
      }
    },
    resumeAfterCanceledRestart: () => {
      for (const handle of states.values()) handle.attachmentController?.setSuspended(false);
    },
    open,
    read: (scopeID) => stateFor(scopeID).cell.snapshot,
    scopes: () => [...states.keys()],
    attachmentController: (scopeID, create) => {
      const handle = stateFor(scopeID);
      handle.attachmentController ??= create();
      if (handle.restartFiles) {
        handle.attachmentController.hydrateDraft(handle.cell.snapshot.value.attachments.map(item => ({
          local_id: item.local_id, request_id: item.upload_request_id, source: item.source,
          name: item.name, mime_type: item.mime_type, size_bytes: item.size_bytes,
          admitted: item.admitted,
        })));
        handle.attachmentController.restoreLocalFiles(handle.restartFiles);
        handle.restartFiles = undefined;
      }
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
    updateAttachmentStagingScope: (scopeID, previous, next) => {
      const handle = stateFor(scopeID);
      const current = handle.stagingScope;
      if (!current || current.staging_scope_id !== previous.staging_scope_id || current.capability !== previous.capability
        || current.target_id !== previous.target_id && current.target_id !== next.target_id) throw new Error('Attachment staging changed during binding.');
      if (previous.staging_scope_id !== next.staging_scope_id || previous.capability !== next.capability) throw new Error('Attachment staging binding changed authority.');
      handle.stagingScope = next;
      handle.attachmentController?.setStagingScope(next);
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
      target.restartFiles = from.restartFiles;
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
      from.restartFiles = undefined;
      from.cell.snapshot = {
        scope_id: fromScopeID,
        revision: sourceSnapshot.revision + 1,
        text_revision: sourceSnapshot.text_revision + (sourceSnapshot.value.text ? 1 : 0),
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
