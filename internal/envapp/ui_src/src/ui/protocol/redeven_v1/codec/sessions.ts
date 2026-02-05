import type { ActiveSession, SessionsListActiveResponse } from '../sdk/sessions';
import type { wire_sessions_active_session, wire_sessions_list_active_resp } from '../wire/sessions';

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function bool(v: unknown): boolean {
  return Boolean(v);
}

export function fromWireActiveSession(s: wire_sessions_active_session): ActiveSession {
  const codeSpaceID = str((s as any)?.code_space_id);
  const sessionKind = str((s as any)?.session_kind);
  return {
    channelId: str((s as any)?.channel_id),
    userPublicID: str((s as any)?.user_public_id),
    userEmail: str((s as any)?.user_email),
    floeApp: str((s as any)?.floe_app),
    codeSpaceID: codeSpaceID || undefined,
    sessionKind: sessionKind || undefined,
    tunnelUrl: str((s as any)?.tunnel_url),
    createdAtUnixMs: num((s as any)?.created_at_unix_ms),
    connectedAtUnixMs: num((s as any)?.connected_at_unix_ms),
    canRead: bool((s as any)?.can_read),
    canWrite: bool((s as any)?.can_write),
    canExecute: bool((s as any)?.can_execute),
  };
}

export function fromWireSessionsListActiveResponse(resp: wire_sessions_list_active_resp): SessionsListActiveResponse {
  const list = Array.isArray((resp as any)?.sessions) ? (resp as any).sessions : [];
  return { sessions: list.map(fromWireActiveSession) };
}
