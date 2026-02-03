import type { ChannelInitGrant } from '@floegence/flowersec-core';

export interface Environment {
  public_id: string;
  name: string;
  description?: string;
  namespace_public_id: string;
  status: string;
  lifecycle_status: string;
}

export type EnvironmentDetail = Environment & {
  agent?: {
    os?: string;
    arch?: string;
    hostname?: string;
    last_seen?: string;
  } | null;
  permissions?: {
    can_read: boolean;
    can_write: boolean;
    can_execute: boolean;
    can_admin: boolean;
    is_owner: boolean;
  };
};

export type EnvFloeApp = {
  app_id: string;
  app_slug: string;
  display_name: string;
  description?: string;
  is_official: boolean;
  enabled: boolean;
};

export type GrantAuditEntry = {
  created_at: string;
  channel_id: string;
  env_public_id: string;
  namespace_public_id: string;
  user_public_id: string;
  floe_app: string;
  can_read_files: boolean;
  can_write_files: boolean;
  can_execute: boolean;
  client_ip?: string;
  user_agent?: string;
  status: string;
  error_code?: string;
};

const SESSION_STORAGE_KEYS = {
  envPublicID: 'redeven_env_public_id',
  brokerToken: 'redeven_broker_token',
} as const;

function getSessionStorage(key: string): string {
  try {
    return String(sessionStorage.getItem(key) ?? '').trim();
  } catch {
    return '';
  }
}

export function getEnvPublicIDFromSession(): string {
  return getSessionStorage(SESSION_STORAGE_KEYS.envPublicID);
}

export function getBrokerTokenFromSession(): string {
  return getSessionStorage(SESSION_STORAGE_KEYS.brokerToken);
}

async function fetchJSON<T>(input: RequestInfo | URL, init: RequestInit & { bearerToken?: string }): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.bearerToken) {
    headers.set('Authorization', `Bearer ${init.bearerToken}`);
  }

  const resp = await fetch(input, { ...init, headers, credentials: 'omit', cache: 'no-store' });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = data?.error?.message ?? `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  if (data?.success === false) {
    throw new Error(data?.error?.message ?? 'Request failed');
  }

  return (data?.data ?? data) as T;
}

export async function getEnvironment(envId: string): Promise<EnvironmentDetail | null> {
  const id = envId.trim();
  if (!id) return null;

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSON<EnvironmentDetail>(`/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}`, {
    method: 'GET',
    bearerToken: brokerToken,
  });
  return out ?? null;
}

export async function getEnvironmentFloeApps(envId: string): Promise<EnvFloeApp[]> {
  const id = envId.trim();
  if (!id) throw new Error('Invalid envId');

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSON<{ apps: EnvFloeApp[] }>(`/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/floe-apps`, {
    method: 'GET',
    bearerToken: brokerToken,
  });
  return Array.isArray(out?.apps) ? out.apps : [];
}

export async function getGrantAudits(envId: string, limit = 50): Promise<GrantAuditEntry[]> {
  const id = envId.trim();
  if (!id) throw new Error('Invalid envId');

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const q = typeof limit === 'number' && limit > 0 ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const out = await fetchJSON<{ entries: GrantAuditEntry[] }>(`/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/grant-audits${q}`, {
    method: 'GET',
    bearerToken: brokerToken,
  });
  return Array.isArray(out?.entries) ? out.entries : [];
}

export async function setEnvironmentFloeAppEnabled(envId: string, appId: string, enabled: boolean): Promise<EnvFloeApp[]> {
  const id = envId.trim();
  const aid = appId.trim();
  if (!id || !aid) throw new Error('Invalid request');

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSON<{ apps: EnvFloeApp[] }>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/floe-apps/${encodeURIComponent(aid)}`,
    {
      method: 'PUT',
      bearerToken: brokerToken,
      body: JSON.stringify({ enabled }),
    },
  );
  return Array.isArray(out?.apps) ? out.apps : [];
}

export async function exchangeBrokerToEntryTicket(args: {
  endpointId: string;
  floeApp: string;
  brokerToken: string;
  codeSpaceId: string;
}): Promise<string> {
  const endpointId = args.endpointId.trim();
  const floeApp = args.floeApp.trim();
  const brokerToken = args.brokerToken.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!endpointId || !floeApp || !brokerToken || !codeSpaceId) throw new Error('Invalid request');

  const out = await fetchJSON<{ entry_ticket: string }>(`/api/srv/v1/floeproxy/entry`, {
    method: 'POST',
    bearerToken: brokerToken,
    body: JSON.stringify({ endpoint_id: endpointId, floe_app: floeApp, code_space_id: codeSpaceId }),
  });
  const t = String(out?.entry_ticket ?? '').trim();
  if (!t) throw new Error('Invalid entry_ticket response');
  return t;
}

export async function mintEnvEntryTicketForApp(args: { envId: string; floeApp: string; codeSpaceId: string }): Promise<string> {
  const envId = args.envId.trim();
  const floeApp = args.floeApp.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!envId || !floeApp || !codeSpaceId) throw new Error('Invalid request');

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSON<{ entry_ticket: string }>(`/api/srv/v1/floeproxy/environments/${encodeURIComponent(envId)}/entry`, {
    method: 'POST',
    bearerToken: brokerToken,
    body: JSON.stringify({ floe_app: floeApp, code_space_id: codeSpaceId }),
  });
  const t = String(out?.entry_ticket ?? '').trim();
  if (!t) throw new Error('Invalid entry_ticket response');
  return t;
}

export async function channelInitEntry(args: { endpointId: string; floeApp: string; entryTicket: string }): Promise<ChannelInitGrant> {
  const endpointId = args.endpointId.trim();
  const floeApp = args.floeApp.trim();
  const entryTicket = args.entryTicket.trim();
  if (!endpointId || !floeApp || !entryTicket) throw new Error('Invalid request');

  const out = await fetchJSON<{ grant_client: ChannelInitGrant }>(
    `/v1/channel/init/entry?endpoint_id=${encodeURIComponent(endpointId)}`,
    {
      method: 'POST',
      bearerToken: entryTicket,
      body: JSON.stringify({ endpoint_id: endpointId, floe_app: floeApp }),
    },
  );
  if (!out?.grant_client) throw new Error('Invalid channel init response');
  return out.grant_client;
}
