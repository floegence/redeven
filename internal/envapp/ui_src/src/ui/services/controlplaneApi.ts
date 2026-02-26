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
const BROKER_RECOVER_REDIRECT_DEBOUNCE_MS = 5_000;
const BROKER_RECOVER_RETRY_WINDOW_MS = 90_000;

let brokerRecoverRedirecting = false;

const SESSION_STORAGE_KEYS = {
  envPublicID: 'redeven_env_public_id',
  // Transitional bootstrap handoff key.
  // The token is hydrated into runtime memory and then removed from storage immediately.
  brokerToken: 'redeven_broker_token',
  brokerRecoverAtMs: 'redeven_broker_recover_at_ms',
} as const;

let runtimeBrokerToken = '';
let runtimeBrokerTokenHydrated = false;

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

function normalizeBrokerToken(raw: string): string {
  return asString(raw);
}

function hydrateBrokerTokenIntoRuntimeBestEffort(): void {
  if (runtimeBrokerTokenHydrated) return;
  runtimeBrokerTokenHydrated = true;

  const fromStorage = normalizeBrokerToken(getSessionStorage(SESSION_STORAGE_KEYS.brokerToken));
  if (!fromStorage) return;

  runtimeBrokerToken = fromStorage;
  removeSessionStorage(SESSION_STORAGE_KEYS.brokerToken);
}

export function setBrokerTokenForRuntime(raw: string): void {
  runtimeBrokerToken = normalizeBrokerToken(raw);
  runtimeBrokerTokenHydrated = true;
}

export function clearBrokerTokenForRuntime(): void {
  runtimeBrokerToken = '';
  runtimeBrokerTokenHydrated = true;
  removeSessionStorage(SESSION_STORAGE_KEYS.brokerToken);
}

export function getBrokerTokenFromSession(): string {
  hydrateBrokerTokenIntoRuntimeBestEffort();
  return runtimeBrokerToken;
}

function parseStatusCodeBestEffort(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}

function asString(v: unknown): string {
  return String(v ?? '').trim();
}

function isBrokerTokenUnauthorizedError(e: unknown): boolean {
  if (!(e instanceof APIError)) return false;
  if (e.status !== 401) return false;

  const msg = asString(e.message).toLowerCase();
  const code = asString(e.code).toUpperCase();
  if (msg.includes('broker_token') || msg.includes('broker token')) return true;
  return code === 'INVALID_BROKER_TOKEN';
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

function brokerRecoverAgeMsBestEffort(): number {
  const raw = getSessionStorage(SESSION_STORAGE_KEYS.brokerRecoverAtMs);
  const at = Number(raw || '0');
  if (!Number.isFinite(at) || at <= 0) return -1;
  return Date.now() - at;
}

function markBrokerRecoverNow(): void {
  setSessionStorage(SESSION_STORAGE_KEYS.brokerRecoverAtMs, String(Date.now()));
}

function clearBrokerRecoverMarker(): void {
  removeSessionStorage(SESSION_STORAGE_KEYS.brokerRecoverAtMs);
}

function redirectToPortalForBrokerRecovery(envPublicID: string): never {
  const envID = asString(envPublicID);
  if (!envID) {
    throw new Error('Missing env context. Please reopen from the Redeven Portal.');
  }

  const age = brokerRecoverAgeMsBestEffort();
  if (age >= 0 && age < BROKER_RECOVER_REDIRECT_DEBOUNCE_MS) {
    throw new Error('Session expired. Redirecting to Redeven Portal...');
  }
  if (age >= 0 && age < BROKER_RECOVER_RETRY_WINDOW_MS) {
    throw new Error('Failed to refresh session. Please reopen from the Redeven Portal.');
  }

  if (brokerRecoverRedirecting) {
    throw new Error('Session expired. Redirecting to Redeven Portal...');
  }
  brokerRecoverRedirecting = true;
  clearBrokerTokenForRuntime();
  markBrokerRecoverNow();

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

async function fetchJSONWithBrokerAutoRecover<T>(
  input: RequestInfo | URL,
  init: RequestInit & { bearerToken?: string },
  opts?: Readonly<{ envPublicID?: string; brokerAutoRecover?: boolean }>,
): Promise<T> {
  try {
    const out = await fetchJSON<T>(input, init);
    if (opts?.brokerAutoRecover) {
      clearBrokerRecoverMarker();
      brokerRecoverRedirecting = false;
    }
    return out;
  } catch (e) {
    if (opts?.brokerAutoRecover && isBrokerTokenUnauthorizedError(e)) {
      const envID = asString(opts.envPublicID) || getEnvPublicIDFromSession();
      redirectToPortalForBrokerRecovery(envID);
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

  const resp = await fetch(input, { ...init, headers, credentials: 'omit', cache: 'no-store' });

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

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSONWithBrokerAutoRecover<EnvironmentDetail>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      bearerToken: brokerToken,
    },
    {
      envPublicID: id,
      brokerAutoRecover: true,
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

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSONWithBrokerAutoRecover<AgentLatestVersion>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(id)}/agent/version/latest`,
    {
      method: 'GET',
      bearerToken: brokerToken,
    },
    {
      envPublicID: id,
      brokerAutoRecover: true,
    },
  );
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

  const out = await fetchJSONWithBrokerAutoRecover<{ entry_ticket: string }>(
    `/api/srv/v1/floeproxy/entry`,
    {
      method: 'POST',
      bearerToken: brokerToken,
      body: JSON.stringify({
        endpoint_id: endpointId,
        floe_app: floeApp,
        code_space_id: codeSpaceId,
        // Env App UI business session (RPC/streams).
        session_kind: 'envapp_rpc',
      }),
    },
    {
      envPublicID: endpointId,
      brokerAutoRecover: true,
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

  const brokerToken = getBrokerTokenFromSession();
  if (!brokerToken) {
    throw new Error('Missing broker token. Please reopen from the Redeven Portal.');
  }

  const out = await fetchJSONWithBrokerAutoRecover<{ entry_ticket: string }>(
    `/api/srv/v1/floeproxy/environments/${encodeURIComponent(envId)}/entry`,
    {
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
    },
    {
      envPublicID: envId,
      brokerAutoRecover: true,
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
