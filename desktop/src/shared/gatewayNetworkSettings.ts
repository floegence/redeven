import type { GatewayEndpoint, GatewayNetworkSettings } from './gatewayMembership';

/** Canonical HTTPS origin shared by network forms and enrollment. */
export function gatewayConnectionOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function ipHost(value: string): string | null {
  if (value.includes(':')) {
    try { const url = new URL(`https://[${value}]`); return url.hostname.slice(1, -1); } catch { return null; }
  }
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value) && value.split('.').every(part => Number(part) <= 255 && String(Number(part)) === part) ? value : null;
}

export function gatewayAllowedHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  const ip = ipHost(host);
  if (ip) return ip;
  return host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) ? host : null;
}

export function gatewayListenAddress(value: string): string | null {
  const address = value.trim();
  const match = /^(\[[^\]]+\]|[^:]*):(\d{1,5})$/u.exec(address);
  if (!match || Number(match[2]) > 65535) return null;
  const rawHost = match[1]!.replace(/^\[|\]$/gu, '');
  const host = rawHost ? gatewayAllowedHost(rawHost) : '';
  if (host === null) return null;
  return `${host.includes(':') ? `[${host}]` : host}:${Number(match[2])}`;
}

export function normalizeGatewayNetworkSettings(value: unknown): GatewayNetworkSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.listen_addresses) || candidate.listen_addresses.length < 1 || candidate.listen_addresses.length > 16
    || !Array.isArray(candidate.allowed_hosts) || candidate.allowed_hosts.length > 64 || !Array.isArray(candidate.endpoints) || candidate.endpoints.length > 16) return null;
  const listen = candidate.listen_addresses.map(item => typeof item === 'string' ? gatewayListenAddress(item) : null);
  const hosts = candidate.allowed_hosts.map(item => typeof item === 'string' ? gatewayAllowedHost(item) : null);
  if (listen.includes(null) || hosts.includes(null) || new Set(listen).size !== listen.length || new Set(hosts).size !== hosts.length) return null;
  const endpoints: GatewayEndpoint[] = [];
  for (const raw of candidate.endpoints) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.endpoint_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(item.endpoint_id) || typeof item.address !== 'string'
      || !['lan','overlay','public'].includes(String(item.scope)) || !Number.isSafeInteger(item.priority) || Number(item.priority) < 0 || Number(item.priority) > 1000) return null;
    if (gatewayConnectionOrigin(item.address) !== item.address) return null;
    endpoints.push({endpoint_id:item.endpoint_id,address:item.address,scope:item.scope as GatewayEndpoint['scope'],priority:Number(item.priority)});
  }
  if (new Set(endpoints.map(item => item.endpoint_id)).size !== endpoints.length || new Set(endpoints.map(item => item.address)).size !== endpoints.length) return null;
  return {listen_addresses:listen as string[],allowed_hosts:hosts as string[],endpoints};
}
