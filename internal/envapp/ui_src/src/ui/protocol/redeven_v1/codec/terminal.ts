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
  wire_terminal_name_update_notify,
  wire_terminal_output_activity_info,
  wire_terminal_output_activity_update_notify,
  wire_terminal_session_create_req,
  wire_terminal_session_create_resp,
  wire_terminal_session_delete_req,
  wire_terminal_session_delete_resp,
  wire_terminal_session_info,
  wire_terminal_session_list_resp,
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
  TerminalNameUpdateEvent,
  TerminalOutputActivityUpdateEvent,
  TerminalSessionCreateRequest,
  TerminalSessionCreateResponse,
  TerminalSessionDeleteRequest,
  TerminalSessionDeleteResponse,
  TerminalSessionInfo,
  TerminalSessionsChangedEvent,
  TerminalWorkStateUpdateEvent,
} from '../sdk/terminal';
import { canonicalAbsolutePath } from '../../../utils/canonicalAbsolutePath';

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
  return {
    ...(name ? { name } : {}),
    ...(workingDir ? { working_dir: workingDir } : {}),
  };
}

export function fromWireTerminalSessionCreateResponse(resp: wire_terminal_session_create_resp): TerminalSessionCreateResponse {
  return { session: toTerminalSessionInfo(resp.session) };
}

export function fromWireTerminalSessionListResponse(resp: wire_terminal_session_list_resp): { sessions: TerminalSessionInfo[] } {
  const sessions = Array.isArray(resp?.sessions) ? resp.sessions : [];
  return { sessions: sessions.map(toTerminalSessionInfo).filter((s) => s.id) };
}

export function toWireTerminalSemanticHistoryRequest(req: TerminalSemanticHistoryRequest): wire_terminal_history_req {
  return {
    session_id: req.sessionId,
    connection_id: req.connectionId,
    transport_generation: req.transportGeneration,
    ...(req.anchor === undefined ? {} : { anchor: req.anchor }),
    direction: req.direction,
    limit: req.limit,
  };
}

export function fromWireTerminalSemanticHistoryResponse(
  resp: wire_terminal_history_resp,
): TerminalSemanticHistoryResponse {
  // The generated RPC layer preserves the wire payload. Validation belongs to
  // the lazy terminal feature, where the published semantic validator is
  // already loaded and the response can be bound to the live attachment.
  return resp as TerminalSemanticHistoryResponse;
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
