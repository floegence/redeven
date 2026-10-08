import { GATEWAY_PROTOCOL_VERSION, type GatewayMemberInvitation, type GatewayEndpoint } from './gatewayMembership';

/** Shape validation precedes local consent; Runtime verifies the signed invitation. */
export function normalizeGatewayInvitation(value: unknown): GatewayMemberInvitation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = ['protocol_version', 'invitation_id', 'gateway_id', 'gateway_name', 'endpoints', 'gateway_public_key', 'gateway_tls_root_pem', 'token', 'issued_at_unix_ms', 'expires_at_unix_ms', 'signature'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || input.protocol_version !== GATEWAY_PROTOCOL_VERSION
    || !Number.isSafeInteger(input.issued_at_unix_ms) || !Number.isSafeInteger(input.expires_at_unix_ms)
    || Number(input.issued_at_unix_ms) <= 0 || Number(input.expires_at_unix_ms) - Number(input.issued_at_unix_ms) !== 600_000) return null;
  if (!Array.isArray(input.endpoints) || input.endpoints.length < 1 || input.endpoints.length > 16) return null;
  const endpoints: GatewayEndpoint[] = [];
  const endpointIDs = new Set<string>(), addresses = new Set<string>();
  for (const raw of input.endpoints) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const endpoint = raw as Record<string, unknown>;
    if (Object.keys(endpoint).some(key => !['endpoint_id', 'address', 'scope', 'priority'].includes(key))) return null;
    if (typeof endpoint.endpoint_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(endpoint.endpoint_id)
      || typeof endpoint.address !== 'string' || endpoint.address.length > 512
      || (endpoint.scope !== 'lan' && endpoint.scope !== 'overlay' && endpoint.scope !== 'public')
      || !Number.isSafeInteger(endpoint.priority) || Number(endpoint.priority) < 0 || Number(endpoint.priority) > 1000) return null;
    try {
      const url = new URL(endpoint.address);
      if (url.protocol !== 'https:' || url.origin !== endpoint.address || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    } catch { return null; }
    if (endpointIDs.has(endpoint.endpoint_id) || addresses.has(endpoint.address)) return null;
    endpointIDs.add(endpoint.endpoint_id); addresses.add(endpoint.address);
    endpoints.push({
      endpoint_id: endpoint.endpoint_id as string,
      address: endpoint.address as string,
      scope: endpoint.scope as GatewayEndpoint['scope'],
      priority: endpoint.priority as number,
    });
  }
  for (const key of ['invitation_id', 'gateway_id']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/u.test(input[key])) return null;
  }
  for (const key of ['token', 'gateway_public_key', 'signature']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/u.test(input[key])) return null;
  }
  if (typeof input.gateway_tls_root_pem !== 'string' || input.gateway_tls_root_pem.length > 16_384
    || !input.gateway_tls_root_pem.startsWith('-----BEGIN CERTIFICATE-----')) return null;
  const invitationID = input.invitation_id as string;
  const gatewayID = input.gateway_id as string;
  if (typeof input.gateway_name !== 'string' || !input.gateway_name.trim() || input.gateway_name.length > 256) return null;
  const gatewayPublicKey = input.gateway_public_key as string;
  const gatewayTLSRootPEM = input.gateway_tls_root_pem as string;
  const token = input.token as string;
  const signature = input.signature as string;
  const issuedAtUnixMS = input.issued_at_unix_ms as number;
  const expiresAtUnixMS = input.expires_at_unix_ms as number;
  return {
    protocol_version: GATEWAY_PROTOCOL_VERSION,
    invitation_id: invitationID,
    gateway_id: gatewayID,
    gateway_name: input.gateway_name,
    endpoints,
    gateway_public_key: gatewayPublicKey,
    gateway_tls_root_pem: gatewayTLSRootPEM,
    token,
    issued_at_unix_ms: issuedAtUnixMS,
    expires_at_unix_ms: expiresAtUnixMS,
    signature,
  };
}

export type GatewayMembershipPhase = 'not_joined' | 'joining' | 'gateway_offline' | 'joined' | 'reauthorization_required' | 'removal_pending' | 'cloud_denied' | 'cloud_pending' | 'cloud_control_offline' | 'accessible' | 'migration_pending';
export type GatewayMembershipStatus = Readonly<{
  joined: boolean;
  phase: GatewayMembershipPhase;
  gateway_id?: string;
  endpoints?: readonly GatewayEndpoint[];
  last_endpoint_id?: string;
  member_id?: string;
  existing_environment_id?: string;
  rejoin_required?: boolean;
  publication_error_code?: string;
}>;
export type GatewayEnvironmentChoice = 'preserve' | 'new';
export type GatewayMembershipOperation = 'join' | 'replace' | 'update-endpoints' | 'status' | 'retry' | 'leave';
