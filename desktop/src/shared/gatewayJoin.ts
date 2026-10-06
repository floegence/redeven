export type GatewayJoinMaterial = Readonly<{
  protocol_version: 1;
  cloud_origin: string;
  region_origin: string;
  namespace_public_id: string;
  gateway_public_id: string;
  request_public_id: string;
  gateway_url: string;
  gateway_tls_root_pem: string;
  join_token: string;
  gateway_enrollment_token: string;
  expires_at_unix_ms: number;
}>;

export function normalizeGatewayJoinMaterial(value: unknown): GatewayJoinMaterial | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = ['protocol_version', 'cloud_origin', 'region_origin', 'namespace_public_id', 'gateway_public_id', 'request_public_id', 'gateway_url', 'gateway_tls_root_pem', 'join_token', 'gateway_enrollment_token', 'expires_at_unix_ms'];
  if (Object.keys(input).some(key => !allowed.includes(key)) || input.protocol_version !== 1
    || !Number.isSafeInteger(input.expires_at_unix_ms) || Number(input.expires_at_unix_ms) <= 0) return null;
  for (const key of ['cloud_origin', 'region_origin', 'gateway_url']) {
    if (typeof input[key] !== 'string' || input[key].length > 512) return null;
    try {
      const url = new URL(input[key]);
      if (url.protocol !== 'https:' || url.origin !== input[key] || url.username || url.password) return null;
    } catch { return null; }
  }
  for (const key of ['namespace_public_id', 'gateway_public_id', 'request_public_id']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input[key])) return null;
  }
  for (const key of ['join_token', 'gateway_enrollment_token']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(input[key])) return null;
  }
  if (typeof input.gateway_tls_root_pem !== 'string' || input.gateway_tls_root_pem.length > 16_384
    || !input.gateway_tls_root_pem.startsWith('-----BEGIN CERTIFICATE-----')) return null;
  return { ...input } as GatewayJoinMaterial;
}

export type GatewayJoinPhase = 'verifying' | 'awaiting_approval' | 'connecting' | 'connected';
