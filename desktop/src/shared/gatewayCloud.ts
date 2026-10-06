export type GatewayCloudSummary = Readonly<{
  configured: boolean;
  cloud_origin?: string;
  gateway_public_id?: string;
  namespace_public_id?: string;
  region?: string;
  state: 'unconfigured' | 'pending' | 'active' | 'revoked' | 'expired' | 'retired' | 'rejoin_required' | 'registering';
  management_url?: string;
}>;

export type GatewayCloudConfiguration = Readonly<{
  cloud_origin: string;
  reauthorize?: boolean;
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
  if (!cloud || Object.keys(input).some(key => !['cloud_origin', 'reauthorize'].includes(key))
    || (input.reauthorize !== undefined && typeof input.reauthorize !== 'boolean')) return null;
  return { cloud_origin: cloud, ...(input.reauthorize === true ? { reauthorize: true } : {}) };

}

export function parseGatewayCloudSummary(raw: string): GatewayCloudSummary {
  if (raw.length > 32 * 1024) throw new Error('Invalid Gateway Cloud response.');
  const value = JSON.parse(raw) as GatewayCloudSummary;
  if (!value || typeof value !== 'object' || typeof value.configured !== 'boolean' || !['unconfigured', 'pending', 'active', 'revoked', 'expired', 'retired', 'rejoin_required', 'registering'].includes(value.state)) throw new Error('Invalid Gateway Cloud response.');
  if (!value.configured) return { configured: false, state: 'unconfigured' };
  if (value.state === 'registering') {
    const origin = new URL(value.cloud_origin ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== value.cloud_origin || origin.username || origin.password) throw new Error('Invalid Gateway Cloud origin.');
    return { configured: true, state: 'registering', cloud_origin: origin.origin };
  }
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
