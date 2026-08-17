import type { ArtifactSource, JsonValue } from '@floegence/flowersec-core';
import type { SpendBindingView, SpendCommitRequest } from '@floegence/floe-webapp-boot';

import { SESSION_KIND_ENVAPP_RPC, sessionKindForLauncherApp, type LauncherFloeApp } from './floeproxyContract';
import { applyLocalAccessResumeHeader } from './localAccessAuth';
import { controlPlaneOriginFromSandboxLocation } from './sandboxOrigins';
import { AccessUnlockError, isKnownAccessUnlockErrorCode, normalizeRetryAfterMs } from './accessUnlockError';
import { replacePendingPluginSessionCredential } from './pluginSessionCredential';

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
  effective_run_mode?: 'local' | 'hybrid' | 'remote';
  remote_enabled?: boolean;
};

export type LocalRuntimeInfo = {
  mode: 'local';
  env_public_id: string;
  direct_ws_url?: string;
  effective_run_mode?: 'local' | 'hybrid' | 'remote';
  remote_enabled?: boolean;
  runtime_service?: unknown;
  access_status?: LocalAccessStatus;
};

export type LocalAccessStatus = {
  password_required: boolean;
  unlocked: boolean;
  exposure?: {
    scope: 'loopback' | 'network';
    transport: 'plaintext';
    password_required: boolean;
  };
  urls?: readonly string[];
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

export class EnvSessionRecoveryError extends Error {
  readonly code: 'MISSING_ENV_CONTEXT' | 'ENV_SESSION_REDIRECTING' | 'ENV_SESSION_REOPEN_REQUIRED';

  constructor(
    code: EnvSessionRecoveryError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'EnvSessionRecoveryError';
    this.code = code;
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

function retryAfterMsFromErrorPayload(data: any): number {
  return normalizeRetryAfterMs(data?.error?.retry_after_ms ?? data?.data?.retry_after_ms);
}

function isEnvSessionUnauthorizedError(e: unknown): boolean {
  if (!(e instanceof APIError)) return false;
  if (e.status !== 401) return false;

  const code = asString(e.code).toUpperCase();
  return code === 'INVALID_ENV_SESSION' || code === 'MISSING_ENV_SESSION' || code === 'UNAUTHORIZED';
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

function controlPlaneOriginFromSandboxOriginBestEffort(): string {
	try {
		return controlPlaneOriginFromSandboxLocation(window.location);
	} catch {
		return window.location.origin;
	}
}

function buildControlPlaneEnvRecoverURL(envPublicID: string): string {
  const envID = asString(envPublicID);
  const controlPlaneOrigin = controlPlaneOriginFromSandboxOriginBestEffort();
  const url = new URL(`${controlPlaneOrigin}/env/${encodeURIComponent(envID)}`);

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

function redirectToControlPlaneForEnvSessionRecovery(envPublicID: string): never {
  const envID = asString(envPublicID);
  if (!envID) {
    throw new EnvSessionRecoveryError(
      'MISSING_ENV_CONTEXT',
      'Missing env context. Please reopen from the control plane.',
    );
  }

  const age = envSessionRecoverAgeMsBestEffort();
  if (age >= 0 && age < ENV_SESSION_RECOVER_REDIRECT_DEBOUNCE_MS) {
    throw new EnvSessionRecoveryError(
      'ENV_SESSION_REDIRECTING',
      'Session expired. Redirecting to the control plane...',
    );
  }
  if (age >= 0 && age < ENV_SESSION_RECOVER_RETRY_WINDOW_MS) {
    throw new EnvSessionRecoveryError(
      'ENV_SESSION_REOPEN_REQUIRED',
      'Failed to refresh session. Please reopen from the control plane.',
    );
  }

  if (envSessionRecoverRedirecting) {
    throw new EnvSessionRecoveryError(
      'ENV_SESSION_REDIRECTING',
      'Session expired. Redirecting to the control plane...',
    );
  }
  envSessionRecoverRedirecting = true;
  markEnvSessionRecoverNow();

  const target = buildControlPlaneEnvRecoverURL(envID);
  try {
    if (window.top && window.top.location) {
      window.top.location.replace(target);
    } else {
      window.location.replace(target);
    }
  } catch {
    window.location.replace(target);
  }

  throw new EnvSessionRecoveryError(
    'ENV_SESSION_REDIRECTING',
    'Session expired. Redirecting to the control plane...',
  );
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
      redirectToControlPlaneForEnvSessionRecovery(envID);
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
    const retryAfterMs = retryAfterMsFromErrorPayload(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({
        status: parseStatusCodeBestEffort(resp.status),
        code,
        message: msg,
        retryAfterMs,
      });
    }
    throw new APIError({ status: parseStatusCodeBestEffort(resp.status), code, message: msg });
  }

  if (data?.success === false) {
    const msg = asString(data?.error?.message) || 'Request failed';
    const code = asString(data?.error?.code) || 'REQUEST_FAILED';
    const retryAfterMs = retryAfterMsFromErrorPayload(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({
        status: parseStatusCodeBestEffort(resp.status) || 400,
        code,
        message: msg,
        retryAfterMs,
      });
    }
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
let localRuntimeLoad: Promise<LocalRuntimeInfo | null> | undefined;
let localRuntimeLoadGeneration = 0;

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
    effective_run_mode: effectiveRunMode,
    remote_enabled: typeof data.remote_enabled === 'boolean' ? data.remote_enabled : undefined,
    runtime_service: data.runtime_service,
  };
}

async function loadLocalRuntimeInfo(): Promise<LocalRuntimeInfo | null> {
  const access = await getLocalAccessStatus();
  if (!access) return null;

  try {
    const out = await fetchLocalJSON<LocalRuntimeInfo>('/api/local/runtime', { method: 'GET' });
    return { ...normalizeLocalRuntimeInfo(out), access_status: access };
  } catch (error) {
    if (error instanceof APIError && error.status === 423) {
      return {
        mode: 'local',
        env_public_id: 'env_local',
        direct_ws_url: buildLocalDirectWSURLBestEffort(),
        access_status: access,
      };
    }
    throw error;
  }
}

export async function getLocalAccessStatus(): Promise<LocalAccessStatus | null> {
  try {
    const out = await fetchLocalJSON<LocalAccessStatus>('/api/local/access/status', { method: 'GET' });
    if (typeof out?.password_required === 'boolean' && typeof out?.unlocked === 'boolean') {
      const exposure = out.exposure && typeof out.exposure === 'object'
        && (out.exposure.scope === 'loopback' || out.exposure.scope === 'network')
        && out.exposure.transport === 'plaintext'
        && typeof out.exposure.password_required === 'boolean'
        ? out.exposure
        : undefined;
      const urls = Array.isArray(out.urls)
        ? out.urls.map((value) => String(value ?? '').trim()).filter(Boolean)
        : undefined;
      return {
        password_required: out.password_required,
        unlocked: out.unlocked,
        ...(exposure ? { exposure } : {}),
        ...(urls && urls.length > 0 ? { urls } : {}),
      };
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
  if (localRuntimeLoad) return localRuntimeLoad;

  const generation = localRuntimeLoadGeneration;
  const request = loadLocalRuntimeInfo()
    .then((runtime) => {
      if (localRuntimeLoadGeneration === generation) {
        cachedLocalRuntime = runtime;
      }
      return runtime;
    })
    .finally(() => {
      if (localRuntimeLoad === request) {
        localRuntimeLoad = undefined;
      }
    });
  localRuntimeLoad = request;
  return request;
}

export async function refreshLocalRuntime(): Promise<LocalRuntimeInfo | null> {
  const generation = ++localRuntimeLoadGeneration;
  cachedLocalRuntime = undefined;
  const request = loadLocalRuntimeInfo()
    .then((runtime) => {
      if (localRuntimeLoadGeneration === generation) {
        cachedLocalRuntime = runtime;
      }
      return runtime;
    })
    .finally(() => {
      if (localRuntimeLoad === request) {
        localRuntimeLoad = undefined;
      }
    });
  localRuntimeLoad = request;
  return request;
}

export type LocalDirectArtifactSourceOptions = Readonly<{
  beforeAcquire?: (context: Readonly<{ signal: AbortSignal }>) => void | Promise<void>;
  afterCredentialStaged?: () => void;
}>;

export async function createLocalDirectArtifactSource(
  options: LocalDirectArtifactSourceOptions = {},
): Promise<ArtifactSource> {
  const { createControlplaneArtifactSource } = await import('@floegence/floe-webapp-boot/artifact-source');
  return createControlplaneArtifactSource({
    baseUrl: window.location.origin,
    endpointId: 'env_local',
    ...(window.location.protocol === 'http:' ? { allowLoopbackHTTP: true } : {}),
    fetch: async (_input, init) => {
      const signal = init?.signal ?? new AbortController().signal;
      await options.beforeAcquire?.({ signal });
      let out: {
        v?: number;
        channel_id?: unknown;
        connect_artifact?: string;
        critical_scope_projection_json?: string;
        spend_scope?: SpendBindingView & { v?: number };
        plugin_session_credential?: unknown;
      };
      try {
        out = await fetchLocalJSON('/api/local/direct/connect_artifact', {
          method: 'POST',
          signal,
        });
      } catch (error) {
        if (!(error instanceof APIError) && !(error instanceof AccessUnlockError)) throw error;
        return new Response(JSON.stringify({
          error: { code: asString(error.code).toLowerCase() },
        }), {
          status: error.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      const channelID = asString(out?.channel_id);
      if (!out?.connect_artifact || !out.critical_scope_projection_json || !out.spend_scope || !channelID) {
        throw new Error('Invalid local direct connect artifact');
      }
      const pluginSessionCredential = asString(out?.plugin_session_credential);
      if (!pluginSessionCredential) {
        throw new Error('Invalid local plugin session credential');
      }
      replacePendingPluginSessionCredential(channelID, pluginSessionCredential);
      options.afterCredentialStaged?.();
      return new Response(JSON.stringify({
        v: out.v ?? 1,
        connect_artifact: out.connect_artifact,
        critical_scope_projection_json: out.critical_scope_projection_json,
        spend_scope: out.spend_scope,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    commitSpend: commitLocalArtifactSpend,
    validateSpendBinding: (binding) => validateTrustedEnvSpendBinding(binding, {
      envPublicId: 'env_local',
      floeApp: 'com.floegence.redeven.agent',
      origin: window.location.origin,
    }),
  });
}

export type EnvironmentDetailSource = 'local' | 'controlplane';

export type EnvironmentDetailRequest = Readonly<{
  source: EnvironmentDetailSource;
  envId: string;
}>;

export async function getLocalEnvironment(): Promise<EnvironmentDetail | null> {
  try {
    const out = await fetchLocalJSON<EnvironmentDetail>('/api/local/environment', { method: 'GET' });
    return out ?? null;
  } catch (error) {
    if (error instanceof APIError && error.status === 423) return null;
    throw error;
  }
}

export async function getControlplaneEnvironment(envId: string): Promise<EnvironmentDetail | null> {
  const id = envId.trim();
  if (!id) return null;

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

export async function getEnvironment(args: EnvironmentDetailRequest): Promise<EnvironmentDetail | null> {
  return args.source === 'local'
    ? getLocalEnvironment()
    : getControlplaneEnvironment(args.envId);
}

export type AgentLatestVersionRequest = Readonly<{
  source: EnvironmentDetailSource;
  envId: string;
}>;

export async function getLocalAgentLatestVersion(): Promise<AgentLatestVersion | null> {
  try {
    const out = await fetchLocalJSON<AgentLatestVersion>('/api/local/agent/version/latest', { method: 'GET' });
    return out ?? null;
  } catch (error) {
    if (error instanceof APIError && error.status === 423) return null;
    throw error;
  }
}

export async function getControlplaneAgentLatestVersion(envId: string): Promise<AgentLatestVersion | null> {
  const id = envId.trim();
  if (!id) return null;

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

export async function getAgentLatestVersion(args: AgentLatestVersionRequest): Promise<AgentLatestVersion | null> {
  return args.source === 'local'
    ? getLocalAgentLatestVersion()
    : getControlplaneAgentLatestVersion(args.envId);
}

export async function mintEnvProxyEntryTicket(args: {
  endpointId: string;
  floeApp: string;
  codeSpaceId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const endpointId = args.endpointId.trim();
  const floeApp = args.floeApp.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!endpointId || !floeApp || !codeSpaceId) throw new Error('Invalid request');

  const out = await fetchJSONWithEnvSessionAutoRecover<{ entry_ticket: string }>(
    '/api/srv/v1/floeproxy/entry',
    {
      method: 'POST',
      credentials: 'include',
      ...(args.signal === undefined ? {} : { signal: args.signal }),
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

export type EnvProxyArtifactSourceOptions = Readonly<{
  endpointId: () => string;
  floeApp: string;
  codeSpaceId: string;
  allowLoopbackHTTP?: boolean;
  traceId?: string;
  prepareAcquire?: (context: Readonly<{ endpointId: string; signal: AbortSignal }>) => void | Promise<void>;
}>;

export async function createEnvProxyArtifactSource(args: EnvProxyArtifactSourceOptions): Promise<ArtifactSource> {
  const floeApp = args.floeApp.trim();
  const codeSpaceId = args.codeSpaceId.trim();
  if (!floeApp || !codeSpaceId) throw new Error('Invalid request');
  const fetchImpl = globalThis.fetch;
  const artifactEndpoint = new URL('/v1/connect/artifact/entry', window.location.origin).toString();
  const { createControlplaneArtifactSource } = await import('@floegence/floe-webapp-boot/artifact-source');

  return createControlplaneArtifactSource({
    baseUrl: window.location.origin,
    endpointId: 'dynamic_env',
    entryTicket: 'dynamic_entry_ticket',
    payload: {
      floe_app: floeApp,
    },
    ...(args.traceId === undefined ? {} : { correlation: { traceId: args.traceId } }),
    ...(args.allowLoopbackHTTP === true ? { allowLoopbackHTTP: true } : {}),
    fetch: async (_input, init) => {
      if (typeof fetchImpl !== 'function') throw new Error('Fetch unavailable');
      const signal = init?.signal ?? new AbortController().signal;
      const endpointId = args.endpointId().trim();
      if (!endpointId) throw new Error('Missing environment context');
      await args.prepareAcquire?.({ endpointId, signal });
      const entryTicket = await mintEnvProxyEntryTicket({
        endpointId,
        floeApp,
        codeSpaceId,
        signal,
      });
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${entryTicket}`);
      return fetchImpl(artifactEndpoint, {
        ...init,
        headers,
        signal,
        body: JSON.stringify({
          endpoint_id: endpointId,
          payload: { floe_app: floeApp },
          ...(args.traceId === undefined ? {} : { correlation: { trace_id: args.traceId } }),
        }),
      });
    },
    commitSpend: commitRemoteArtifactSpend,
    validateSpendBinding: (binding) => validateTrustedEnvSpendBinding(binding, {
      envPublicId: args.endpointId().trim(),
      floeApp,
      origin: window.location.origin,
    }),
  });
}

function validateTrustedEnvSpendBinding(binding: SpendBindingView, expected: Readonly<{
  envPublicId: string;
  floeApp: string;
  origin: string;
}>): string {
  const values = [
    binding.artifactDigestB64u,
    binding.projectionDigestB64u,
    binding.launcherOrigin,
    binding.runtimeOrigin,
    binding.appOrigin,
    binding.consumer,
    binding.expiresAt,
  ];
  if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new Error('Invalid spend binding');
  }
  if (binding.consumer !== 'trusted' || binding.launcherOrigin !== expected.origin ||
      binding.runtimeOrigin !== expected.origin || binding.appOrigin !== expected.origin) {
    throw new Error('Spend origin binding mismatch');
  }
  const target = binding.targetBinding;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error('Invalid spend target binding');
  }
  const record = target as Record<string, JsonValue>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ['env_public_id', 'floe_app', 'kind', 'launcher_id', 'launcher_kind', 'v'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) ||
      record.v !== 1 || record.kind !== 'env' || record.env_public_id !== expected.envPublicId ||
      record.floe_app !== expected.floeApp || record.launcher_kind !== 'env' || record.launcher_id !== expected.envPublicId) {
    throw new Error('Spend target binding mismatch');
  }
  return `${binding.artifactDigestB64u}.${binding.projectionDigestB64u}`;
}

async function commitLocalArtifactSpend(request: SpendCommitRequest, signal?: AbortSignal): Promise<void> {
  await fetchLocalJSON('/api/local/direct/artifact/spend', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      attempt_id: request.attemptId,
      receipt: request.receipt,
      artifact_digest_b64u: request.artifactDigestB64u,
      projection_digest_b64u: request.projectionDigestB64u,
      launcher_origin: request.launcherOrigin,
      runtime_origin: request.runtimeOrigin,
      app_origin: request.appOrigin,
      consumer: request.consumer,
      target_binding: request.targetBinding,
      expires_at: request.expiresAt,
    }),
  });
}

async function commitRemoteArtifactSpend(request: SpendCommitRequest, signal?: AbortSignal): Promise<void> {
  const receipt = request.receipt.trim();
  if (!receipt) throw new Error('Missing artifact spend receipt');
  await fetchJSON('/api/srv/v1/floeproxy/artifact/spend', {
    method: 'POST',
    signal,
    bearerToken: receipt,
    body: JSON.stringify({
      v: 1,
      attempt_id: request.attemptId,
      artifact_digest_b64u: request.artifactDigestB64u,
      projection_digest_b64u: request.projectionDigestB64u,
      runtime_origin: request.runtimeOrigin,
      app_origin: request.appOrigin,
      consumer: request.consumer,
      target_binding: request.targetBinding,
      expires_at: request.expiresAt,
    }),
  });
}
