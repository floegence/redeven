import type { ChannelInitGrant, DirectConnectInfo } from '@floegence/flowersec-core';

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
  recommended_version?: string;
  manifest_etag?: string;
  source?: string;
  stale?: boolean;
  fetched_at_ms?: number;
  cache_ttl_ms?: number;
  message?: string;
};

export type LocalRuntimeInfo = {
  mode: 'local';
  env_public_id: string;
  direct_ws_url?: string;
};

class APIError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: Readonly<{ status: number; code: string; message: string }>) {
    super(args.message);
    this.status = args.status;
    this.code = args.code;
  }
}

const ENV_APP_PATH_PREFIX = '/_redeven_proxy/env';
const ENV_SESSION_RECOVER_REDIRECT_DEBOUNCE_MS = 5_000;
const ENV_SESSION_RECOVER_RETRY_WINDOW_MS = 90_000;

let envSessionRecoverRedirecting = false;

const SESSION_STORAGE_KEYS = {
  envPublicID: 'redeven_env_public_id',
  envSessionRecoverAtMs: 'redeven_env_session_recover_at_ms',
} as const;

function getSessionStorage(key: string): string {
  try {
    return String(sessionStorage.getItem(key) ?? '').trim();
  } catch {
    return '';
  }
}

function setSessionStorage(key: string, v: string): void {
  try {
    sessionStorage.setItem(key, v);
  } catch {
    // ignore
  }
}

function removeSessionStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getEnvPublicIDFromSession(): string {
  return getSessionStorage(SESSION_STORAGE_KEYS.envPublicID);
}

function parseStatusCodeBestEffort(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function asString(v: unknown): string {
  return String(v ?? '').trim();
}

function isEnvSessionUnauthorizedError(e: unknown): boolean {
  if (!(e instanceof APIError)) return false;
  if (e.status !== 401) return false;

  const code = asString(e.code).toUpperCase();
  if (code === 'INVALID_ENV_SESSION' || code === 'MISSING_ENV_SESSION' || code === 'UNAUTHORIZED') return true;

  const msg = asString(e.message).toLowerCase();
  return msg.includes('env_session') || msg.includes('env session');
}

function isEnvAppPath(pathname: string): boolean {
  const p = asString(pathname);
  return p === ENV_APP_PATH_PREFIX || p === `${ENV_APP_PATH_PREFIX}/` || p.startsWith(`${ENV_APP_PATH_PREFIX}/`);
}

function currentEnvAppReturnToBestEffort(): string {
  try {
    const pathname = asString(window.location.pathname);
    if (!isEnvAppPath(pathname)) return '';
    return `${pathname}${asString(window.location.search)}`;
  } catch {
    return '';
  }
}

function portalOriginFromSandboxOriginBestEffort(): string {
  const proto = window.location.protocol;
  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  const host = window.location.hostname.toLowerCase();
  // Map <sandbox-id>.<region>.<base-domain> to <region>.<base-domain>.
  const rest = host.split('.').slice(1).join('.') || host;
  return `${proto}//${rest}${portSuffix}`;
}

function buildPortalEnvRecoverURL(envPublicID: string): string {
  const envID = asString(envPublicID);
  const portalOrigin = portalOriginFromSandboxOriginBestEffort();
  const url = new URL(`${portalOrigin}/env/${encodeURIComponent(envID)}`);

  const returnTo = currentEnvAppReturnToBestEffort();
  if (returnTo) {
    url.searchParams.set('return_to', returnTo);
  }
  return url.toString();
}

function envSessionRecoverAgeMsBestEffort(): number {
  const raw = getSessionStorage(SESSION_STORAGE_KEYS.envSessionRecoverAtMs);
  const at = Number(raw || '0');
  if (!Number.isFinite(at) || at <= 0) return -1;
  return Date.now() - at;
}

function markEnvSessionRecoverNow(): void {
  setSessionStorage(SESSION_STORAGE_KEYS.envSessionRecoverAtMs, String(Date.now()));
}

function clearEnvSessionRecoverMarker(): void {
  removeSessionStorage(SESSION_STORAGE_KEYS.envSessionRecoverAtMs);
}

function redirectToPortalForEnvSessionRecovery(envPublicID: string): never {
  const envID = asString(envPublicID);
  if (!envID) {
    throw new Error('Missing env context. Please reopen from the Redeven Portal.');
  }

  const age = envSessionRecoverAgeMsBestEffort();
  if (age >= 0 && age < ENV_SESSION_RECOVER_REDIRECT_DEBOUNCE_MS) {
    throw new Error('Session expired. Redirecting to Redeven Portal...');
  }
  if (age >= 0 && age < ENV_SESSION_RECOVER_RETRY_WINDOW_MS) {
    throw new Error('Failed to refresh session. Please reopen from the Redeven Portal.');
  }

  if (envSessionRecoverRedirecting) {
    throw new Error('Session expired. Redirecting to Redeven Portal...');
  }
  envSessionRecoverRedirecting = true;
  markEnvSessionRecoverNow();

  const target = buildPortalEnvRecoverURL(envID);
  try {
    if (window.top && window.top.location) {
      window.top.location.replace(target);
    } else {
      window.location.replace(target);
    }
  } catch {
    window.location.replace(target);
  }

  throw new Error('Session expired. Redirecting to Redeven Portal...');
}

async function fetchJSONWithEnvSessionAutoRecover<T>(
  input: RequestInfo | URL,
  init: RequestInit & { bearerToken?: string },
  opts?: Readonly<{ envPublicID?: string; envSessionAutoRecover?: boolean }>,
): Promise<T> {
  try {
    const out = await fetchJSON<T>(input, init);
    if (opts?.envSessionAutoRecover) {
      clearEnvSessionRecoverMarker();
      envSessionRecoverRedirecting = false;
    }
    return out;
  } catch (e) {
    if (opts?.envSessionAutoRecover && isEnvSessionUnauthorizedError(e)) {
      const envID = asString(opts.envPublicID) || getEnvPublicIDFromSession();
      redirectToPortalForEnvSessionRecovery(envID);
    }
    throw e;
  }
}

async function fetchJSON<T>(input: RequestInfo | URL, init: RequestInit & { bearerToken?: string }): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.bearerToken) {
    headers.set('Authorization', `Bearer ${init.bearerToken}`);
  }

  const resp = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'omit',
    cache: 'no-store',
  });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const msg = asString(data?.error?.message) || `HTTP ${resp.status}`;
    const code = asString(data?.error?.code) || 'HTTP_ERROR';
    throw new APIError({ status: parseStatusCodeBestEffort(resp.status), code, message: msg });
  }

  if (data?.success === false) {
    const msg = asString(data?.error?.message) || 'Request failed';
    const code = asString(data?.error?.code) || 'REQUEST_FAILED';
    throw new APIError({ status: parseStatusCodeBestEffort(resp.status) || 400, code, message: msg });
  }

  return (data?.data ?? data) as T;
}

function isLoopbackOriginBestEffort(): boolean {
  try {
    const host = String(window.location.hostname ?? '').trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

let cachedLocalRuntime: LocalRuntimeInfo | null | undefined = undefined;

export async function getLocalRuntime(): Promise<LocalRuntimeInfo | null> {
  if (cachedLocalRuntime !== undefined) return cachedLocalRuntime;

  // Local UI mode is loopback-only. Avoid probing /api/local/* on sandbox domains (404 noise).
  if (!isLoopbackOriginBestEffort()) {
    cachedLocalRuntime = null;
    return null;
  }

  try {
    const out = await fetchJSON<LocalRuntimeInfo>('/api/local/runtime', { method: 'GET' });
    if (out && String((out as any).mode ?? '') === 'local') {
      cachedLocalRuntime = out;
      return out;
    }
  } catch {
    // ignore
  }

  cachedLocalRuntime = null;
  return null;
}

export async function mintLocalDirectConnectInfo(): Promise<DirectConnectInfo> {
  const out = await fetchJSON<DirectConnectInfo>('/api/local/direct/connect_info', { method: 'POST' });
  const wsURL = String((out as any)?.ws_url ?? '').trim();
  const channelID = String((out as any)?.channel_id ?? '').trim();
  if (!wsURL || !channelID) throw new Error('Invalid direct connect info');
  return out;
}

export async function getEnvironment(envId: string): Promise<EnvironmentDetail | null> {
  const id = envId.trim();
  if (!id) return null;

  const local = await getLocalRuntime();
  if (local) {
    const out = await fetchJSON<EnvironmentDetail>('/api/local/environment', { method: 'GET' });
    return out ?? null;
  }

  const out = await fetchJSONWithEnvSessionAutoRecover<EnvironmentDetail>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      credentials: 'include',
    },
    {
      envPublicID: id,
      envSessionAutoRecover: true,
    },
  );
  return out ?? null;
}

export async function getAgentLatestVersion(envId: string): Promise<AgentLatestVersion | null> {
  const id = envId.trim();
  if (!id) return null;

  const local = await getLocalRuntime();
  if (local) {
    const out = await fetchJSON<AgentLatestVersion>('/api/local/agent/version/latest', { method: 'GET' });
    return out ?? null;
  }

  const out = await fetchJSONWithEnvSessionAutoRecover<AgentLatestVersion>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/agent/version/latest`,
    {
      method: 'GET',
      credentials: 'include',
    },
    {
      envPublicID: id,
      envSessionAutoRecover: true,
    },
  );
  return out ?? null;
}

export async function mintEnvProxyEntryTicket(args: { endpointId: string; floeApp: string; codeSpaceId: string }): Promise<string> {
  const endpointId = args.endpointId.trim();
  const floeApp = args.floeApp.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!endpointId || !floeApp || !codeSpaceId) throw new Error('Invalid request');

  const out = await fetchJSONWithEnvSessionAutoRecover<{ entry_ticket: string }>(
    '/api/srv/v1/floeproxy/entry',
    {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        endpoint_id: endpointId,
        floe_app: floeApp,
        code_space_id: codeSpaceId,
        // Env App business RPC channel.
        session_kind: 'envapp_rpc',
      }),
    },
    {
      envPublicID: endpointId,
      envSessionAutoRecover: true,
    },
  );
  const t = String(out?.entry_ticket ?? '').trim();
  if (!t) throw new Error('Invalid entry_ticket response');
  return t;
}

export async function mintEnvEntryTicketForApp(args: { envId: string; floeApp: string; codeSpaceId: string }): Promise<string> {
  const envId = args.envId.trim();
  const floeApp = args.floeApp.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!envId || !floeApp || !codeSpaceId) throw new Error('Invalid request');

  const out = await fetchJSONWithEnvSessionAutoRecover<{ entry_ticket: string }>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(envId)}/entry`,
    {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        floe_app: floeApp,
        code_space_id: codeSpaceId,
        // Codespaces and other app launches use dedicated session kinds on the data plane.
        session_kind:
          floeApp === 'com.floegence.redeven.code'
            ? 'codeapp'
            : floeApp === 'com.floegence.redeven.portforward'
              ? 'portforward'
              : 'app',
      }),
    },
    {
      envPublicID: envId,
      envSessionAutoRecover: true,
    },
  );
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
