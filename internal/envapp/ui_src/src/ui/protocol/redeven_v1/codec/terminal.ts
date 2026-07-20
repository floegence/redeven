import { bytesFromBase64 } from './base64';
import { normalizeTerminalForegroundCommandDisplayName } from '@floegence/floeterm-terminal-web/sessions';
import type {
  wire_terminal_foreground_command_info,
  wire_terminal_foreground_command_update_notify,
  wire_terminal_history_req,
  wire_terminal_history_resp,
  wire_terminal_name_update_notify,
  wire_terminal_session_create_req,
  wire_terminal_session_create_resp,
  wire_terminal_session_delete_req,
  wire_terminal_session_delete_resp,
  wire_terminal_session_info,
  wire_terminal_session_list_resp,
  wire_terminal_session_stats_req,
  wire_terminal_session_stats_resp,
  wire_terminal_clear_req,
  wire_terminal_clear_resp,
  wire_terminal_sessions_changed_notify,
} from '../wire/terminal';
import type {
  TerminalClearRequest,
  TerminalClearResponse,
  TerminalHistoryRequest,
  TerminalHistoryResponse,
  TerminalForegroundCommandUpdateEvent,
  TerminalNameUpdateEvent,
  TerminalSessionCreateRequest,
  TerminalSessionCreateResponse,
  TerminalSessionDeleteRequest,
  TerminalSessionDeleteResponse,
  TerminalSessionInfo,
  TerminalSessionStatsRequest,
  TerminalSessionStatsResponse,
  TerminalSessionsChangedEvent,
} from '../sdk/terminal';

import type { TerminalForegroundCommandInfo } from '@floegence/floeterm-terminal-web';

const UNKNOWN_FOREGROUND_COMMAND: TerminalForegroundCommandInfo = Object.freeze({
  phase: 'unknown',
  displayName: '',
  revision: 0,
  updatedAtMs: 0,
});

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

function toTerminalSessionInfo(s: wire_terminal_session_info): TerminalSessionInfo {
  return {
    id: String(s?.id ?? ''),
    name: String(s?.name ?? ''),
    workingDir: String(s?.working_dir ?? ''),
    createdAtMs: Number(s?.created_at_ms ?? 0),
    lastActiveAtMs: Number(s?.last_active_at_ms ?? 0),
    isActive: Boolean(s?.is_active ?? false),
    foregroundCommand: fromWireTerminalForegroundCommandInfo(s?.foreground_command)
      ?? { ...UNKNOWN_FOREGROUND_COMMAND },
  };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function optionalHistorySequence(resp: object, field: string): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(resp, field)) return undefined;
  const value = (resp as Record<string, unknown>)[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return Number.NaN;
  return value;
}

function hasOwnField(resp: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(resp, field);
}

export function toWireTerminalSessionCreateRequest(req: TerminalSessionCreateRequest): wire_terminal_session_create_req {
  return {
    name: req.name?.trim() ? req.name.trim() : undefined,
    working_dir: req.workingDir?.trim() ? req.workingDir.trim() : undefined,
  };
}

export function fromWireTerminalSessionCreateResponse(resp: wire_terminal_session_create_resp): TerminalSessionCreateResponse {
  return { session: toTerminalSessionInfo(resp.session) };
}

export function fromWireTerminalSessionListResponse(resp: wire_terminal_session_list_resp): { sessions: TerminalSessionInfo[] } {
  const sessions = Array.isArray(resp?.sessions) ? resp.sessions : [];
  return { sessions: sessions.map(toTerminalSessionInfo).filter((s) => s.id) };
}

export function toWireTerminalHistoryRequest(req: TerminalHistoryRequest): wire_terminal_history_req {
  return {
    session_id: req.sessionId,
    start_seq: req.startSeq,
    end_seq: req.endSeq,
    history_generation: positiveInteger(req.historyGeneration),
    limit_chunks: positiveInteger(req.limitChunks),
    max_bytes: positiveInteger(req.maxBytes),
  };
}

export function fromWireTerminalHistoryResponse(resp: wire_terminal_history_resp): TerminalHistoryResponse {
  const chunks = Array.isArray(resp?.chunks) ? resp.chunks : [];
  return {
    chunks: chunks
      .map((c) => ({
        sequence: Number(c?.sequence ?? 0),
        timestampMs: Number(c?.timestamp_ms ?? 0),
        data: bytesFromBase64(String(c?.data_b64 ?? '')),
      }))
      .filter((c) => c.data.length > 0),
    nextStartSeq: Number(resp?.next_start_seq ?? 0),
    hasMore: Boolean(resp?.has_more ?? false),
    firstSequence: Number(resp?.first_sequence ?? 0),
    lastSequence: Number(resp?.last_sequence ?? 0),
    ...(hasOwnField(resp, 'covered_through_sequence')
      ? { coveredThroughSequence: optionalHistorySequence(resp, 'covered_through_sequence') }
      : {}),
    ...(hasOwnField(resp, 'snapshot_end_sequence')
      ? { snapshotEndSequence: optionalHistorySequence(resp, 'snapshot_end_sequence') }
      : {}),
    ...(hasOwnField(resp, 'first_retained_sequence')
      ? { firstRetainedSequence: optionalHistorySequence(resp, 'first_retained_sequence') }
      : {}),
    ...(hasOwnField(resp, 'history_generation')
      ? { historyGeneration: optionalHistorySequence(resp, 'history_generation') }
      : {}),
    historyReset: Boolean(resp?.history_reset ?? false),
    historyTruncated: Boolean(resp?.history_truncated ?? false),
    coveredBytes: Number(resp?.covered_bytes ?? 0),
    totalBytes: Number(resp?.total_bytes ?? 0),
  };
}

export function toWireTerminalClearRequest(req: TerminalClearRequest): wire_terminal_clear_req {
  return { session_id: req.sessionId };
}

export function fromWireTerminalClearResponse(resp: wire_terminal_clear_resp): TerminalClearResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function toWireTerminalSessionDeleteRequest(req: TerminalSessionDeleteRequest): wire_terminal_session_delete_req {
  return { session_id: req.sessionId };
}

export function fromWireTerminalSessionDeleteResponse(resp: wire_terminal_session_delete_resp): TerminalSessionDeleteResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function toWireTerminalSessionStatsRequest(req: TerminalSessionStatsRequest): wire_terminal_session_stats_req {
  return { session_id: req.sessionId };
}

export function fromWireTerminalSessionStatsResponse(resp: wire_terminal_session_stats_resp): TerminalSessionStatsResponse {
  const totalBytes = Number(resp?.history?.total_bytes ?? 0);
  return { history: { totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0 } };
}

export function fromWireTerminalNameUpdateNotify(payload: wire_terminal_name_update_notify): TerminalNameUpdateEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  if (!sessionId) return null;
  return {
    sessionId,
    newName: String(payload?.new_name ?? ''),
    workingDir: String(payload?.working_dir ?? ''),
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
