import { GATEWAY_PROTOCOL_VERSION, type GatewayMemberInvitation } from './gatewayMembership';

/** Shape validation precedes local consent; Runtime verifies the signed invitation. */
export function normalizeGatewayInvitation(value: unknown): GatewayMemberInvitation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = ['protocol_version', 'invitation_id', 'gateway_id', 'gateway_url', 'gateway_public_key', 'gateway_tls_root_pem', 'token', 'issued_at_unix_ms', 'expires_at_unix_ms', 'signature'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || input.protocol_version !== GATEWAY_PROTOCOL_VERSION
    || !Number.isSafeInteger(input.issued_at_unix_ms) || !Number.isSafeInteger(input.expires_at_unix_ms)
    || Number(input.issued_at_unix_ms) <= 0 || Number(input.expires_at_unix_ms) - Number(input.issued_at_unix_ms) !== 600_000) return null;
  if (typeof input.gateway_url !== 'string' || input.gateway_url.length > 512) return null;
  try {
    const url = new URL(input.gateway_url);
    if (url.protocol !== 'https:' || url.origin !== input.gateway_url || url.username || url.password) return null;
  } catch { return null; }
  for (const key of ['invitation_id', 'gateway_id']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(input[key])) return null;
  }
  for (const key of ['token', 'gateway_public_key', 'signature']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/u.test(input[key])) return null;
  }
  if (typeof input.gateway_tls_root_pem !== 'string' || input.gateway_tls_root_pem.length > 16_384
    || !input.gateway_tls_root_pem.startsWith('-----BEGIN CERTIFICATE-----')) return null;
  return { ...input } as GatewayMemberInvitation;
}

export type GatewayMembershipPhase = 'not_joined' | 'joining' | 'gateway_offline' | 'joined' | 'reauthorization_required' | 'removal_pending' | 'cloud_denied' | 'cloud_pending' | 'cloud_control_offline' | 'accessible' | 'migration_pending';
export type GatewayMembershipStatus = Readonly<{
  joined: boolean;
  phase: GatewayMembershipPhase;
  gateway_id?: string;
  gateway_url?: string;
  member_id?: string;
  existing_environment_id?: string;
  rejoin_required?: boolean;
  publication_error_code?: string;
}>;
export type GatewayEnvironmentChoice = 'preserve' | 'new';
export type GatewayMembershipOperation = 'join' | 'replace' | 'update-address' | 'status' | 'retry' | 'leave';
