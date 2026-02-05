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

export type AgentLatestVersion = {
  latest_version: string;
  fetched_at_ms?: number;
  cache_ttl_ms?: number;
  message?: string;
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

export async function getAgentLatestVersion(envId: string): Promise<AgentLatestVersion | null> {
  const id = envId.trim();
  if (!id) return null;

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSON<AgentLatestVersion>(`/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/agent/version/latest`, {
    method: 'GET',
    bearerToken: brokerToken,
  });
  return out ?? null;
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
    body: JSON.stringify({
      endpoint_id: endpointId,
      floe_app: floeApp,
      code_space_id: codeSpaceId,
      // Env App UI business session (RPC/streams).
      session_kind: 'envapp_rpc',
    }),
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
    body: JSON.stringify({
      floe_app: floeApp,
      code_space_id: codeSpaceId,
      // Codespaces (code-server) and other apps are single-channel sessions on the data plane; tag them as codeapp/app.
      session_kind:
        floeApp === 'com.floegence.redeven.code'
          ? 'codeapp'
          : floeApp === 'com.floegence.redeven.portforward'
            ? 'portforward'
            : 'app',
    }),
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
