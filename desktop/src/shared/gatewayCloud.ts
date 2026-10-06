export type GatewayCloudSummary = Readonly<{
  configured: boolean;
  cloud_origin?: string;
  gateway_public_id?: string;
  namespace_public_id?: string;
  region?: string;
  state: 'unconfigured' | 'pending' | 'active' | 'revoked';
  management_url?: string;
}>;

export type GatewayCloudConfiguration = Readonly<{
  cloud_origin: string;
  gateway_url: string;
  egress_listen: string;
}>;

export function normalizeGatewayCloudConfiguration(value: unknown): GatewayCloudConfiguration | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const origin = (raw: unknown): string | null => {
    if (typeof raw !== 'string' || raw.length > 512) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.origin === raw && !url.username && !url.password ? raw : null;
    } catch { return null; }
  };
  const cloud = origin(input.cloud_origin);
  const gateway = origin(input.gateway_url);
  const listen = input.egress_listen;
  if (!cloud || !gateway || typeof listen !== 'string' || listen.length > 255 || !/^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):[0-9]{1,5}$/u.test(listen)) return null;
  const port = Number(listen.slice(listen.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535) return null;
  return { cloud_origin: cloud, gateway_url: gateway, egress_listen: listen };
}

export function parseGatewayCloudSummary(raw: string): GatewayCloudSummary {
  if (raw.length > 32 * 1024) throw new Error('Invalid Gateway Cloud response.');
  const value = JSON.parse(raw) as GatewayCloudSummary;
  if (!value || typeof value !== 'object' || typeof value.configured !== 'boolean' || !['unconfigured', 'pending', 'active', 'revoked'].includes(value.state)) throw new Error('Invalid Gateway Cloud response.');
  if (!value.configured) return { configured: false, state: 'unconfigured' };
  const validID = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/u.test(id);
  if (value.state === 'unconfigured' || !validID(value.gateway_public_id)
    || (value.namespace_public_id !== undefined && value.namespace_public_id !== '' && !validID(value.namespace_public_id))
    || (value.state === 'active' && (!validID(value.namespace_public_id) || !validID(value.region)))) throw new Error('Invalid Gateway Cloud identity.');
  const origin = new URL(value.cloud_origin ?? '');
  const management = new URL(value.management_url ?? '');
  if (origin.protocol !== 'https:' || origin.origin !== value.cloud_origin || management.origin !== origin.origin || !value.gateway_public_id || management.username || management.password) throw new Error('Invalid Gateway Cloud management URL.');
  return { configured: true, cloud_origin: origin.origin, gateway_public_id: value.gateway_public_id,
    namespace_public_id: value.namespace_public_id, region: value.region, state: value.state, management_url: management.href };
}
