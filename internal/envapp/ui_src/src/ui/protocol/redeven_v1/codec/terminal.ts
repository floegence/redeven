import {
  normalizeTerminalExecutionContextInfo,
  normalizeTerminalForegroundCommandDisplayName,
  normalizeTerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web/sessions';
import type {
  wire_terminal_execution_context_info,
  wire_terminal_execution_context_update_notify,
  wire_terminal_clear_req,
  wire_terminal_clear_resp,
  wire_terminal_foreground_command_info,
  wire_terminal_foreground_command_update_notify,
  wire_terminal_history_req,
  wire_terminal_history_resp,
  wire_terminal_group,
  wire_terminal_group_catalog_changed_notify,
  wire_terminal_group_create_req,
  wire_terminal_group_delete_req,
  wire_terminal_group_delete_resp,
  wire_terminal_group_list_resp,
  wire_terminal_group_mutation_resp,
  wire_terminal_group_reorder_req,
  wire_terminal_group_update_req,
  wire_terminal_name_update_notify,
  wire_terminal_output_activity_info,
  wire_terminal_output_activity_update_notify,
  wire_terminal_session_create_req,
  wire_terminal_session_create_resp,
  wire_terminal_session_delete_req,
  wire_terminal_session_delete_resp,
  wire_terminal_session_info,
  wire_terminal_session_list_resp,
  wire_terminal_session_move_req,
  wire_terminal_session_move_resp,
  wire_terminal_sessions_changed_notify,
  wire_terminal_work_state_info,
  wire_terminal_work_state_update_notify,
} from '../wire/terminal';
import type {
  TerminalSemanticHistoryRequest,
  TerminalSemanticHistoryResponse,
  TerminalSemanticClearRequest,
  TerminalSemanticClearResponse,
  TerminalForegroundCommandUpdateEvent,
  TerminalExecutionContextUpdateEvent,
  TerminalGroup,
  TerminalGroupCatalogChangedEvent,
  TerminalGroupCatalogSnapshot,
  TerminalGroupCreateRequest,
  TerminalGroupDeleteRequest,
  TerminalGroupDeleteResponse,
  TerminalGroupMutationResponse,
  TerminalGroupReorderRequest,
  TerminalGroupUpdateRequest,
  TerminalNameUpdateEvent,
  TerminalOutputActivityUpdateEvent,
  TerminalSessionCreateRequest,
  TerminalSessionCreateResponse,
  TerminalSessionDeleteRequest,
  TerminalSessionDeleteResponse,
  TerminalSessionInfo,
  TerminalSessionMoveRequest,
  TerminalSessionMoveResponse,
  TerminalSessionsChangedEvent,
  TerminalWorkStateUpdateEvent,
} from '../sdk/terminal';
import { canonicalAbsolutePath } from '../../../utils/canonicalAbsolutePath';
import { bytesFromBase64 } from './base64';

import type {
  TerminalExecutionContextInfo,
  TerminalForegroundCommandInfo,
  TerminalOutputActivityInfo,
  TerminalWorkStateInfo,
} from '@floegence/floeterm-terminal-web';

const UNKNOWN_FOREGROUND_COMMAND: TerminalForegroundCommandInfo = Object.freeze({
  phase: 'unknown',
  displayName: '',
  revision: 0,
  updatedAtMs: 0,
});

const UNKNOWN_OUTPUT_ACTIVITY: TerminalOutputActivityInfo = Object.freeze({
  phase: 'unknown',
  revision: 0,
  updatedAtMs: 0,
});

const UNKNOWN_EXECUTION_CONTEXT = Object.freeze(normalizeTerminalExecutionContextInfo(undefined));
const UNKNOWN_WORK_STATE = Object.freeze(normalizeTerminalWorkStateInfo(undefined));

function sameExecutionContext(left: TerminalExecutionContextInfo, right: TerminalExecutionContextInfo): boolean {
  return left.location.kind === right.location.kind
    && left.location.phase === right.location.phase
    && left.location.label === right.location.label
    && left.location.authority === right.location.authority
    && left.location.workingDirectory === right.location.workingDirectory
    && left.location.source === right.location.source
    && left.application.kind === right.application.kind
    && left.application.identity === right.application.identity
    && left.application.displayName === right.application.displayName
    && left.revision === right.revision
    && left.updatedAtMs === right.updatedAtMs;
}

function sameWorkState(left: TerminalWorkStateInfo, right: TerminalWorkStateInfo): boolean {
  return left.phase === right.phase
    && left.source === right.source
    && left.contextRevision === right.contextRevision
    && left.foregroundCommandRevision === right.foregroundCommandRevision
    && left.revision === right.revision
    && left.updatedAtMs === right.updatedAtMs;
}

export function fromWireTerminalExecutionContextInfo(
  value: wire_terminal_execution_context_info | null | undefined,
): TerminalExecutionContextInfo | null {
  if (!value || typeof value !== 'object' || !value.location || !value.application) return null;
  const candidate: TerminalExecutionContextInfo = {
    location: {
      kind: value.location.kind,
      phase: value.location.phase,
      label: value.location.label,
      authority: value.location.authority,
      workingDirectory: value.location.working_directory,
      source: value.location.source,
    },
    application: {
      kind: value.application.kind,
      identity: value.application.identity,
      displayName: value.application.display_name,
    },
    revision: value.revision,
    updatedAtMs: value.updated_at_ms,
  };
  const normalized = normalizeTerminalExecutionContextInfo(candidate);
  return sameExecutionContext(candidate, normalized) ? normalized : null;
}

export function fromWireTerminalWorkStateInfo(
  value: wire_terminal_work_state_info | null | undefined,
): TerminalWorkStateInfo | null {
  if (!value || typeof value !== 'object') return null;
  const candidate: TerminalWorkStateInfo = {
    phase: value.phase,
    source: value.source,
    contextRevision: value.context_revision,
    foregroundCommandRevision: value.foreground_command_revision,
    revision: value.revision,
    updatedAtMs: value.updated_at_ms,
  };
  const normalized = normalizeTerminalWorkStateInfo(candidate);
  return sameWorkState(candidate, normalized) ? normalized : null;
}

export function fromWireTerminalForegroundCommandInfo(
  value: wire_terminal_foreground_command_info | null | undefined,
): TerminalForegroundCommandInfo | null {
  if (!value || typeof value !== 'object') return null;
  const phase = value.phase;
  const displayName = value.display_name;
  const revision = value.revision;
  const updatedAtMs = value.updated_at_ms;
  if (phase !== 'unknown' && phase !== 'idle' && phase !== 'running') return null;
  if (typeof displayName !== 'string') return null;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) return null;
  if (phase !== 'running' && displayName !== '') return null;
  const normalizedDisplayName = normalizeTerminalForegroundCommandDisplayName(displayName);
  if (displayName && normalizedDisplayName !== displayName) return null;
  return {
    phase,
    displayName: phase === 'running' ? normalizedDisplayName : '',
    revision,
    updatedAtMs,
  };
}

export function fromWireTerminalOutputActivityInfo(
  value: wire_terminal_output_activity_info | null | undefined,
): TerminalOutputActivityInfo | null {
  if (!value || typeof value !== 'object') return null;
  const phase = value.phase;
  const revision = value.revision;
  const updatedAtMs = value.updated_at_ms;
  if (phase !== 'unknown' && phase !== 'streaming' && phase !== 'settled') return null;
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) return null;
  return { phase, revision, updatedAtMs };
}

function toTerminalSessionInfo(s: wire_terminal_session_info): TerminalSessionInfo {
  const localCapabilityWorkingDir = canonicalAbsolutePath(
    s?.local_path_capability?.working_dir,
  );
  return {
    id: String(s?.id ?? ''),
    groupId: String(s?.group_id ?? '').trim(),
    name: String(s?.name ?? ''),
    workingDir: String(s?.working_dir ?? ''),
    createdAtMs: Number(s?.created_at_ms ?? 0),
    lastActiveAtMs: Number(s?.last_active_at_ms ?? 0),
    isActive: Boolean(s?.is_active ?? false),
    foregroundCommand: fromWireTerminalForegroundCommandInfo(s?.foreground_command)
      ?? { ...UNKNOWN_FOREGROUND_COMMAND },
    outputActivity: fromWireTerminalOutputActivityInfo(s?.output_activity)
      ?? { ...UNKNOWN_OUTPUT_ACTIVITY },
    executionContext: fromWireTerminalExecutionContextInfo(s?.execution_context)
      ?? { ...UNKNOWN_EXECUTION_CONTEXT, location: { ...UNKNOWN_EXECUTION_CONTEXT.location }, application: { ...UNKNOWN_EXECUTION_CONTEXT.application } },
    workState: fromWireTerminalWorkStateInfo(s?.work_state)
      ?? { ...UNKNOWN_WORK_STATE },
    ...(localCapabilityWorkingDir
      ? { localPathCapability: { workingDir: localCapabilityWorkingDir } }
      : {}),
  };
}

export function toWireTerminalSessionCreateRequest(req: TerminalSessionCreateRequest): wire_terminal_session_create_req {
  const name = req.name?.trim();
  const workingDir = req.workingDir?.trim();
  const groupId = req.groupId?.trim();
  return {
    ...(name ? { name } : {}),
    ...(workingDir ? { working_dir: workingDir } : {}),
    ...(groupId ? { group_id: groupId } : {}),
  };
}

export function fromWireTerminalSessionCreateResponse(resp: wire_terminal_session_create_resp): TerminalSessionCreateResponse {
  const session = toTerminalSessionInfo(resp.session);
  if (!session.id || !session.groupId) throw new Error('invalid terminal session create response');
  return { session };
}

export function fromWireTerminalSessionListResponse(resp: wire_terminal_session_list_resp): { sessions: TerminalSessionInfo[] } {
  if (!Array.isArray(resp?.sessions)) throw new Error('invalid terminal session list response');
  const sessions = resp.sessions.map(toTerminalSessionInfo);
  if (sessions.some((session) => !session.id || !session.groupId)) {
    throw new Error('terminal session list contains an ungrouped session');
  }
  return { sessions };
}

function fromWireTerminalGroup(value: wire_terminal_group): TerminalGroup {
  const id = String(value?.id ?? '').trim();
  const name = String(value?.name ?? '').trim();
  const defaultWorkingDir = canonicalAbsolutePath(value?.default_working_dir);
  const sortOrder = Number(value?.sort_order);
  const createdAtMs = Number(value?.created_at_ms);
  const updatedAtMs = Number(value?.updated_at_ms);
  const isDefault = value?.is_default;
  if (!id || !name || !defaultWorkingDir || !Number.isSafeInteger(sortOrder) || sortOrder < 0
    || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0
    || !Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0
    || typeof isDefault !== 'boolean'
    || Array.from(name).length > 64
    || (id === 'default') !== isDefault
    || (isDefault && (name !== 'Default' || sortOrder !== 0))) {
    throw new Error('invalid terminal group');
  }
  return { id, name, defaultWorkingDir, sortOrder, createdAtMs, updatedAtMs, isDefault };
}

function terminalCatalogRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('invalid terminal group catalog revision');
  }
  return revision;
}

export function fromWireTerminalGroupListResponse(resp: wire_terminal_group_list_resp): TerminalGroupCatalogSnapshot {
  const groups = Array.isArray(resp?.groups) ? resp.groups.map(fromWireTerminalGroup) : [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const group of groups) {
    const foldedName = group.name.toLocaleLowerCase();
    if (ids.has(group.id) || names.has(foldedName)) {
      throw new Error('terminal group catalog contains duplicates');
    }
    ids.add(group.id);
    names.add(foldedName);
  }
  if (groups.filter((group) => group.id === 'default' && group.isDefault).length !== 1) {
    throw new Error('terminal group catalog is missing Default');
  }
  return { revision: terminalCatalogRevision(resp?.revision), groups };
}

export function toWireTerminalGroupCreateRequest(req: TerminalGroupCreateRequest): wire_terminal_group_create_req {
  return { name: req.name.trim(), default_working_dir: req.defaultWorkingDir.trim() };
}

export function toWireTerminalGroupUpdateRequest(req: TerminalGroupUpdateRequest): wire_terminal_group_update_req {
  return {
    group_id: req.groupId.trim(),
    ...(req.name === undefined ? {} : { name: req.name.trim() }),
    ...(req.defaultWorkingDir === undefined ? {} : { default_working_dir: req.defaultWorkingDir.trim() }),
  };
}

export function fromWireTerminalGroupMutationResponse(resp: wire_terminal_group_mutation_resp): TerminalGroupMutationResponse {
  return { revision: terminalCatalogRevision(resp?.revision), group: fromWireTerminalGroup(resp?.group) };
}

export function toWireTerminalGroupDeleteRequest(req: TerminalGroupDeleteRequest): wire_terminal_group_delete_req {
  return { group_id: req.groupId.trim() };
}

export function fromWireTerminalGroupDeleteResponse(resp: wire_terminal_group_delete_resp): TerminalGroupDeleteResponse {
  if (!Array.isArray(resp?.failed_session_ids)) throw new Error('invalid terminal group delete response');
  const failedSessionIds = resp.failed_session_ids.map((value) => String(value).trim());
  if (failedSessionIds.some((sessionId) => !sessionId) || new Set(failedSessionIds).size !== failedSessionIds.length) {
    throw new Error('invalid terminal group delete response');
  }
  return { revision: terminalCatalogRevision(resp?.revision), failedSessionIds };
}

export function toWireTerminalGroupReorderRequest(req: TerminalGroupReorderRequest): wire_terminal_group_reorder_req {
  const groupId = String(req.groupId ?? '').trim();
  const beforeGroupId = String(req.beforeGroupId ?? '').trim();
  return {
    group_id: groupId,
    ...(beforeGroupId ? { before_group_id: beforeGroupId } : {}),
  };
}

export function toWireTerminalSessionMoveRequest(req: TerminalSessionMoveRequest): wire_terminal_session_move_req {
  return { session_id: req.sessionId.trim(), group_id: req.groupId.trim() };
}

export function fromWireTerminalSessionMoveResponse(resp: wire_terminal_session_move_resp): TerminalSessionMoveResponse {
  const sessionId = String(resp?.session_id ?? '').trim();
  const groupId = String(resp?.group_id ?? '').trim();
  if (!sessionId || !groupId) throw new Error('invalid terminal session move response');
  return { revision: terminalCatalogRevision(resp?.revision), sessionId, groupId };
}

export function fromWireTerminalGroupCatalogChangedNotify(
  payload: wire_terminal_group_catalog_changed_notify,
): TerminalGroupCatalogChangedEvent | null {
  const reason = payload?.reason;
  if (reason !== 'created' && reason !== 'updated' && reason !== 'deleted' && reason !== 'reordered' && reason !== 'session_moved') return null;
  const revision = Number(payload?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  const groupId = String(payload?.group_id ?? '').trim();
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!groupId || (reason === 'session_moved' && !sessionId)) return null;
  return {
    reason,
    revision,
    ...(groupId ? { groupId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function toWireTerminalSemanticHistoryRequest(req: TerminalSemanticHistoryRequest): wire_terminal_history_req {
  return {
    session_id: req.sessionId,
    connection_id: req.connectionId,
    transport_generation: req.transportGeneration,
    ...('continuation' in req
      ? {
          continuation: req.continuation,
          ...(req.lane === undefined ? {} : { lane: req.lane }),
        }
      : {
          ...(req.lane === undefined ? {} : { lane: req.lane }),
          ...(req.anchor === undefined ? {} : { anchor: req.anchor }),
          ...(req.snapshotId === undefined ? {} : { snapshot_id: req.snapshotId }),
          direction: req.direction,
          ...(req.offset === undefined ? {} : { offset: req.offset }),
          ...(req.scrollDeltaRows === undefined ? {} : { scroll_delta_rows: req.scrollDeltaRows }),
          ...(req.targetOffset === undefined ? {} : { target_offset: req.targetOffset }),
          viewport_rows: req.viewportRows,
        }),
  };
}

export function fromWireTerminalSemanticHistoryResponse(
  resp: wire_terminal_history_resp,
): TerminalSemanticHistoryResponse {
  return {
    snapshotId: resp.snapshotId,
    ...(resp.continuation === undefined ? {} : { continuation: resp.continuation }),
    ...(resp.lane === undefined ? {} : { lane: resp.lane }),
    chunkIndex: resp.chunkIndex,
    chunkCount: resp.chunkCount,
    payloadBytes: resp.payloadBytes,
    payloadSha256: resp.payloadSha256,
    payload: bytesFromBase64(resp.payload),
    revision: resp.revision,
    transportGeneration: resp.transportGeneration,
    contentEpoch: resp.contentEpoch,
    geometryGeneration: resp.geometryGeneration,
    cols: resp.cols,
    rows: resp.rows,
    anchor: resp.anchor,
    firstAvailable: resp.firstAvailable,
    lastAvailable: resp.lastAvailable,
    screenStart: resp.screenStart,
    offset: resp.offset,
    totalRows: resp.totalRows,
    screenStartOffset: resp.screenStartOffset,
    ...(resp.historyEpoch === undefined ? {} : { historyEpoch: resp.historyEpoch }),
    ...(resp.firstRowOrdinal === undefined ? {} : { firstRowOrdinal: resp.firstRowOrdinal }),
    ...(resp.screenStartRowOrdinal === undefined ? {} : { screenStartRowOrdinal: resp.screenStartRowOrdinal }),
    hasPrevious: resp.hasPrevious,
    hasNext: resp.hasNext,
  };
}

export function toWireTerminalSemanticClearRequest(
  req: TerminalSemanticClearRequest,
): wire_terminal_clear_req {
  return {
    session_id: req.sessionId,
    connection_id: req.connectionId,
    transport_generation: req.transportGeneration,
  };
}

export function fromWireTerminalSemanticClearResponse(
  resp: wire_terminal_clear_resp,
): TerminalSemanticClearResponse {
  const presentationSequence = Number(resp?.presentation_sequence ?? 0);
  const contentEpoch = Number(resp?.content_epoch ?? 0);
  if (!Number.isSafeInteger(presentationSequence) || presentationSequence <= 0) {
    throw new Error('invalid terminal semantic clear presentation sequence');
  }
  if (!Number.isSafeInteger(contentEpoch) || contentEpoch <= 0) {
    throw new Error('invalid terminal semantic clear content epoch');
  }
  return { presentationSequence, contentEpoch };
}

export function toWireTerminalSessionDeleteRequest(req: TerminalSessionDeleteRequest): wire_terminal_session_delete_req {
  return { session_id: req.sessionId };
}

export function fromWireTerminalSessionDeleteResponse(resp: wire_terminal_session_delete_resp): TerminalSessionDeleteResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function fromWireTerminalNameUpdateNotify(payload: wire_terminal_name_update_notify): TerminalNameUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  const rawCapability = payload?.local_path_capability;
  const capabilityWorkingDir = rawCapability && typeof rawCapability === 'object'
    ? canonicalAbsolutePath(rawCapability.working_dir)
    : '';
  return {
    sessionId,
    newName: String(payload?.new_name ?? ''),
    workingDir: String(payload?.working_dir ?? ''),
    localPathCapability: capabilityWorkingDir ? { workingDir: capabilityWorkingDir } : null,
  };
}

export function fromWireTerminalForegroundCommandUpdateNotify(
  payload: wire_terminal_foreground_command_update_notify,
): TerminalForegroundCommandUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  const foregroundCommand = fromWireTerminalForegroundCommandInfo(payload?.foreground_command);
  return foregroundCommand ? { sessionId, foregroundCommand } : null;
}

export function fromWireTerminalOutputActivityUpdateNotify(
  payload: wire_terminal_output_activity_update_notify,
): TerminalOutputActivityUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  const outputActivity = fromWireTerminalOutputActivityInfo(payload?.output_activity);
  return outputActivity ? { sessionId, outputActivity } : null;
}

export function fromWireTerminalExecutionContextUpdateNotify(
  payload: wire_terminal_execution_context_update_notify,
): TerminalExecutionContextUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  const executionContext = fromWireTerminalExecutionContextInfo(payload?.execution_context);
  return executionContext ? { sessionId, executionContext } : null;
}

export function fromWireTerminalWorkStateUpdateNotify(
  payload: wire_terminal_work_state_update_notify,
): TerminalWorkStateUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  const workState = fromWireTerminalWorkStateInfo(payload?.work_state);
  return workState ? { sessionId, workState } : null;
}

export function fromWireTerminalSessionsChangedNotify(payload: wire_terminal_sessions_changed_notify): TerminalSessionsChangedEvent | null {
  const reasonRaw = String((payload as any)?.reason ?? '').trim();
  const reason = reasonRaw === 'created'
    || reasonRaw === 'closing'
    || reasonRaw === 'closed'
    || reasonRaw === 'deleted'
    || reasonRaw === 'close_failed_hidden'
    ? reasonRaw
    : '';
  if (!reason) return null;

  const sessionId = typeof (payload as any)?.session_id === 'string' ? String((payload as any).session_id).trim() : '';
  const ts = (payload as any)?.timestamp_ms;
  const lifecycleRaw = String((payload as any)?.lifecycle ?? '').trim();
  const lifecycle = lifecycleRaw === 'open'
    || lifecycleRaw === 'closing'
    || lifecycleRaw === 'closed'
    || lifecycleRaw === 'close_failed_hidden'
    ? lifecycleRaw
    : '';
  const ownerWidgetId = typeof (payload as any)?.owner_widget_id === 'string' ? String((payload as any).owner_widget_id).trim() : '';
  const failureCode = typeof (payload as any)?.failure_code === 'string' ? String((payload as any).failure_code).trim() : '';
  const failureMessage = typeof (payload as any)?.failure_message === 'string' ? String((payload as any).failure_message).trim() : '';

  return {
    reason: reason as TerminalSessionsChangedEvent['reason'],
    sessionId: sessionId || undefined,
    timestampMs: typeof ts === 'number' ? ts : undefined,
    lifecycle: lifecycle ? lifecycle as TerminalSessionsChangedEvent['lifecycle'] : undefined,
    hidden: typeof (payload as any)?.hidden === 'boolean' ? Boolean((payload as any).hidden) : undefined,
    ownerWidgetId: ownerWidgetId || undefined,
    failureCode: failureCode || undefined,
    failureMessage: failureMessage || undefined,
  };
}
