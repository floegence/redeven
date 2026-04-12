import { createEntryControlplaneArtifactSource } from '@floegence/floe-webapp-boot';
import { assertConnectArtifact, type ConnectArtifact } from '@floegence/flowersec-core';

import { SESSION_KIND_ENVAPP_RPC, sessionKindForLauncherApp, type LauncherFloeApp } from './floeproxyContract';
import { appendLocalAccessResumeQuery, applyLocalAccessResumeHeader } from './localAccessAuth';
import { portalOriginFromSandboxLocation } from './sandboxOrigins';

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
  current_version?: string;
  latest_version?: string;
  recommended_version?: string;
  upgrade_policy?: 'self_upgrade' | 'desktop_release' | 'manual';
  release_page_url?: string;
  source_release_tag?: string;
  manifest_etag?: string;
  source?: string;
  stale?: boolean;
  fetched_at_ms?: number;
  cache_ttl_ms?: number;
  message?: string;
  desktop_managed?: boolean;
  effective_run_mode?: 'local' | 'hybrid' | 'remote';
  remote_enabled?: boolean;
};

export type LocalRuntimeInfo = {
  mode: 'local';
  env_public_id: string;
  direct_ws_url?: string;
  desktop_managed?: boolean;
  effective_run_mode?: 'local' | 'hybrid' | 'remote';
  remote_enabled?: boolean;
};

export type LocalAccessStatus = {
  password_required: boolean;
  unlocked: boolean;
};

export type LocalAccessUnlockResult = {
  unlocked: boolean;
  session_expires_at_unix_ms?: number;
  resume_token?: string;
  resume_expires_at_unix_ms?: number;
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
  return portalOriginFromSandboxLocation(window.location);
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

function buildLocalDirectWSURLBestEffort(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/_redeven_direct/ws`;
}

async function fetchLocalJSON<T>(input: RequestInfo | URL, init: RequestInit & { bearerToken?: string }): Promise<T> {
  const headers = new Headers(init.headers);
  applyLocalAccessResumeHeader(headers);
  return fetchJSON<T>(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}

let cachedLocalRuntime: LocalRuntimeInfo | null | undefined = undefined;

function normalizeLocalRuntimeInfo(raw: unknown): LocalRuntimeInfo {
  const data = (raw ?? {}) as Record<string, unknown>;
  const mode = 'local';
  const envPublicID = asString(data.env_public_id) || 'env_local';
  const effectiveRunModeRaw = asString(data.effective_run_mode).toLowerCase();
  const effectiveRunMode = effectiveRunModeRaw === 'hybrid' || effectiveRunModeRaw === 'remote' || effectiveRunModeRaw === 'local'
    ? effectiveRunModeRaw
    : undefined;
  return {
    mode,
    env_public_id: envPublicID,
    direct_ws_url: asString(data.direct_ws_url) || buildLocalDirectWSURLBestEffort(),
    desktop_managed: Boolean(data.desktop_managed),
    effective_run_mode: effectiveRunMode,
    remote_enabled: typeof data.remote_enabled === 'boolean' ? data.remote_enabled : undefined,
  };
}

async function loadLocalRuntimeInfo(): Promise<LocalRuntimeInfo | null> {
  const access = await getLocalAccessStatus();
  if (!access) return null;

  try {
    const out = await fetchLocalJSON<LocalRuntimeInfo>('/api/local/runtime', { method: 'GET' });
    return normalizeLocalRuntimeInfo(out);
  } catch (error) {
    if (error instanceof APIError && error.status === 423) {
      return {
        mode: 'local',
        env_public_id: 'env_local',
        direct_ws_url: buildLocalDirectWSURLBestEffort(),
      };
    }
    throw error;
  }
}

export async function getLocalAccessStatus(): Promise<LocalAccessStatus | null> {
  try {
    const out = await fetchLocalJSON<LocalAccessStatus>('/api/local/access/status', { method: 'GET' });
    if (typeof out?.password_required === 'boolean' && typeof out?.unlocked === 'boolean') {
      return out;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function unlockLocalAccess(password: string): Promise<LocalAccessUnlockResult> {
  const out = await fetchLocalJSON<LocalAccessUnlockResult>('/api/local/access/unlock', {
    method: 'POST',
    body: JSON.stringify({ password: String(password ?? '') }),
  });
  const unlocked = Boolean(out?.unlocked) || Boolean(String(out?.resume_token ?? '').trim());
  if (!unlocked) throw new Error('Unlock failed');
  return { ...out, unlocked: true };
}

export async function getLocalRuntime(): Promise<LocalRuntimeInfo | null> {
  if (cachedLocalRuntime !== undefined) return cachedLocalRuntime;
  cachedLocalRuntime = await loadLocalRuntimeInfo();
  return cachedLocalRuntime;
}

export async function refreshLocalRuntime(): Promise<LocalRuntimeInfo | null> {
  cachedLocalRuntime = await loadLocalRuntimeInfo();
  return cachedLocalRuntime;
}

export async function mintLocalDirectConnectArtifact(): Promise<ConnectArtifact> {
  const out = await fetchLocalJSON<{ connect_artifact?: unknown }>('/api/local/direct/connect_artifact', { method: 'POST' });
  const artifact = assertConnectArtifact(out?.connect_artifact);
  if (artifact.transport !== 'direct') {
    throw new Error('Invalid local direct connect artifact');
  }
  const wsURL = asString(artifact.direct_info?.ws_url);
  const channelID = asString(artifact.direct_info?.channel_id);
  if (!wsURL || !channelID) {
    throw new Error('Invalid local direct connect artifact');
  }
  return {
    ...artifact,
    direct_info: {
      ...artifact.direct_info,
      ws_url: appendLocalAccessResumeQuery(wsURL),
    },
  };
}

export async function getEnvironment(envId: string): Promise<EnvironmentDetail | null> {
  const id = envId.trim();
  if (!id) return null;

  const local = await getLocalRuntime();
  if (local) {
    try {
      const out = await fetchLocalJSON<EnvironmentDetail>('/api/local/environment', { method: 'GET' });
      return out ?? null;
    } catch (error) {
      if (error instanceof APIError && error.status === 423) return null;
      throw error;
    }
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
    try {
      const out = await fetchLocalJSON<AgentLatestVersion>('/api/local/agent/version/latest', { method: 'GET' });
      return out ?? null;
    } catch (error) {
      if (error instanceof APIError && error.status === 423) return null;
      throw error;
    }
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
        session_kind: SESSION_KIND_ENVAPP_RPC,
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

export async function mintEnvEntryTicketForApp(args: { envId: string; floeApp: LauncherFloeApp; codeSpaceId: string }): Promise<string> {
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
        session_kind: sessionKindForLauncherApp(floeApp),
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

export async function connectArtifactEntry(args: {
  endpointId: string;
  floeApp: string;
  entryTicket: string;
  signal?: AbortSignal;
  traceId?: string;
}): Promise<ConnectArtifact> {
  const endpointId = args.endpointId.trim();
  const floeApp = args.floeApp.trim();
  const entryTicket = args.entryTicket.trim();
  if (!endpointId || !floeApp || !entryTicket) throw new Error('Invalid request');

  return createEntryControlplaneArtifactSource({
    endpointId,
    entryTicket,
    credentials: 'omit',
    payload: {
      floe_app: floeApp,
    },
  }).getArtifact({
    ...(args.signal === undefined ? {} : { signal: args.signal }),
    ...(args.traceId === undefined ? {} : { traceId: args.traceId }),
  });
}
