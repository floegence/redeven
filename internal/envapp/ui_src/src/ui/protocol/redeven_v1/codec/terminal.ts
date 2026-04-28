import { bytesFromBase64, bytesToBase64 } from './base64';
import type {
  wire_terminal_history_req,
  wire_terminal_history_resp,
  wire_terminal_name_update_notify,
  wire_terminal_output_notify,
  wire_terminal_session_attach_req,
  wire_terminal_session_attach_resp,
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
  wire_terminal_input_notify,
  wire_terminal_resize_notify,
  wire_terminal_sessions_changed_notify,
} from '../wire/terminal';
import type {
  TerminalClearRequest,
  TerminalClearResponse,
  TerminalHistoryRequest,
  TerminalHistoryResponse,
  TerminalNameUpdateEvent,
  TerminalOutputEvent,
  TerminalSessionAttachRequest,
  TerminalSessionAttachResponse,
  TerminalSessionCreateRequest,
  TerminalSessionCreateResponse,
  TerminalSessionDeleteRequest,
  TerminalSessionDeleteResponse,
  TerminalSessionInfo,
  TerminalSessionStatsRequest,
  TerminalSessionStatsResponse,
  TerminalSessionsChangedEvent,
} from '../sdk/terminal';

function toTerminalSessionInfo(s: wire_terminal_session_info): TerminalSessionInfo {
  return {
    id: String(s?.id ?? ''),
    name: String(s?.name ?? ''),
    workingDir: String(s?.working_dir ?? ''),
    createdAtMs: Number(s?.created_at_ms ?? 0),
    lastActiveAtMs: Number(s?.last_active_at_ms ?? 0),
    isActive: Boolean(s?.is_active ?? false),
  };
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
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

export function toWireTerminalSessionAttachRequest(req: TerminalSessionAttachRequest): wire_terminal_session_attach_req {
  return {
    session_id: req.sessionId,
    conn_id: req.connId,
    cols: req.cols,
    rows: req.rows,
  };
}

export function fromWireTerminalSessionAttachResponse(resp: wire_terminal_session_attach_resp): TerminalSessionAttachResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function toWireTerminalHistoryRequest(req: TerminalHistoryRequest): wire_terminal_history_req {
  return {
    session_id: req.sessionId,
    start_seq: req.startSeq,
    end_seq: req.endSeq,
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

export function fromWireTerminalOutputNotify(payload: wire_terminal_output_notify): TerminalOutputEvent | null {
  const sessionId = String(payload?.session_id ?? '').trim();
  const b64 = String(payload?.data_b64 ?? '');
  if (!sessionId || !b64) return null;

  return {
    sessionId,
    data: bytesFromBase64(b64),
    sequence: typeof payload.sequence === 'number' ? payload.sequence : undefined,
    timestampMs: typeof payload.timestamp_ms === 'number' ? payload.timestamp_ms : undefined,
    echoOfInput: typeof payload.echo_of_input === 'boolean' ? payload.echo_of_input : undefined,
    originalSource: typeof payload.original_source === 'string' ? payload.original_source : undefined,
  };
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

export function toWireTerminalResizeNotify(args: { sessionId: string; connId: string; cols: number; rows: number }): wire_terminal_resize_notify {
  return {
    session_id: args.sessionId,
    conn_id: args.connId,
    cols: args.cols,
    rows: args.rows,
  };
}

export function toWireTerminalInputNotify(args: { sessionId: string; connId: string; data: Uint8Array }): wire_terminal_input_notify {
  return {
    session_id: args.sessionId,
    conn_id: args.connId,
    data_b64: bytesToBase64(args.data),
  };
}
