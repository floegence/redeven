import http from 'node:http';
import https from 'node:https';

import { isAllowedAppNavigation } from './navigation';
import { type StartupReport } from './startup';
import { normalizeLocalUIBaseURL } from './localUIURL';
import {
  envAppShellUnavailableOpenReadiness,
  normalizeRuntimeServiceSnapshot,
  runtimeServiceIsOpenable,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

export type RuntimeProbeOptions = Readonly<{
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

export type RuntimeProbeFailure = Readonly<{
  kind: 'timeout' | 'network_error' | 'invalid_response';
  code?: string;
  status_code?: number;
}>;

export type RuntimeProbeResult<T> = Readonly<
  | { ok: true; value: T }
  | { ok: false; failure: RuntimeProbeFailure }
>;

type RuntimeProbeResponse = RuntimeProbeResult<Readonly<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}>>;

type RuntimeProbeStatus = Readonly<{
  status: 'online';
  password_required: boolean;
  desktop_managed?: boolean;
  desktop_owner_id?: string;
  started_at_unix_ms?: number;
  runtime_service?: RuntimeServiceSnapshot;
}>;

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

type EnvAppShellValidation = Readonly<{
  ok: boolean;
  assetPaths: readonly string[];
}>;

type EnvAppShellProbeResult = 'ready' | 'invalid' | 'unavailable';

type EnvAppShellProbeOutcome = Readonly<{
  result: EnvAppShellProbeResult;
  assetFingerprint?: string;
}>;

const ENV_APP_ROOT_MOUNT_PATTERN = /<div\b[^>]*\bid\s*=\s*["']root["'][^>]*>/iu;
const ENV_APP_ASSET_REF_PATTERN = /\b(?:src|href)\s*=\s*["'](\/_redeven_proxy\/env\/assets\/[^"']+)["']/giu;
const envAppShellFingerprintByRuntimeIdentity = new Map<string, string>();
const envAppShellSuccessCache = new Set<string>();

function request(
  url: URL,
  options: Readonly<{
    timeoutMs: number;
    signal?: AbortSignal;
    method?: 'GET' | 'HEAD';
    accept?: string;
  }>,
): Promise<RuntimeProbeResponse> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === 'https:' ? https.request : http.request;
    let timedOut = false;
    const request = requestImpl(url, {
      method: options.method ?? 'GET',
      timeout: options.timeoutMs,
      signal: options.signal,
      headers: {
        Accept: options.accept ?? 'application/json;q=1.0,text/html;q=0.8,*/*;q=0.5',
      },
    }, (response) => {
      const statusCode = typeof response.statusCode === 'number' ? response.statusCode : 0;
      if (options.method === 'HEAD') {
        response.resume();
        response.on('end', () => {
          resolve({ ok: true, value: { statusCode, headers: response.headers, body: '' } });
        });
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ ok: true, value: { statusCode, headers: response.headers, body } });
      });
    });

    request.on('timeout', () => {
      timedOut = true;
      request.destroy(new Error('request timed out'));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (options.signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        reject(error);
        return;
      }
      if (timedOut) {
        resolve({ ok: false, failure: { kind: 'timeout' } });
        return;
      }
      const code = String(error.code ?? '').trim();
      resolve({
        ok: false,
        failure: {
          kind: 'network_error',
          ...(code ? { code } : {}),
        },
      });
    });
    request.end();
  });
}

function parseLocalRuntimeHealthResponse(raw: string): RuntimeProbeStatus | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner = parsed?.data;
    if (!inner || typeof inner !== 'object') {
      return null;
    }
    const data = inner as Record<string, unknown>;
    if (String(data.status ?? '').trim().toLowerCase() !== 'online' || typeof data.password_required !== 'boolean') {
      return null;
    }
    return {
      status: 'online',
      password_required: data.password_required,
      ...(typeof data.desktop_managed === 'boolean' ? { desktop_managed: data.desktop_managed } : {}),
      ...(String(data.desktop_owner_id ?? '').trim() !== '' ? { desktop_owner_id: String(data.desktop_owner_id).trim() } : {}),
      ...(() => {
        const startedAtUnixMS = normalizePositiveInteger(data.started_at_unix_ms);
        return startedAtUnixMS ? { started_at_unix_ms: startedAtUnixMS } : {};
      })(),
      ...(data.runtime_service ? { runtime_service: normalizeRuntimeServiceSnapshot(data.runtime_service) } : {}),
    };
  } catch {
    return null;
  }
}

async function probeRedevenLocalUIHealth(
  baseURL: string,
  options: Required<Pick<RuntimeProbeOptions, 'timeoutMs'>> & Pick<RuntimeProbeOptions, 'signal'>,
): Promise<RuntimeProbeResult<RuntimeProbeStatus>> {
  if (!isAllowedAppNavigation(baseURL, baseURL)) {
    return { ok: false, failure: { kind: 'invalid_response' } };
  }
  const probeURL = new URL('/api/local/runtime/health', baseURL);
  const response = await request(probeURL, options);
  if (!response.ok) {
    return response;
  }
  if (response.value.statusCode !== 200) {
    return {
      ok: false,
      failure: {
        kind: 'invalid_response',
        status_code: response.value.statusCode,
      },
    };
  }
  const status = parseLocalRuntimeHealthResponse(response.value.body);
  if (!status) {
    return { ok: false, failure: { kind: 'invalid_response' } };
  }
  return { ok: true, value: status };
}

function validateEnvAppShellHTML(body: string): EnvAppShellValidation {
  if (!ENV_APP_ROOT_MOUNT_PATTERN.test(body)) {
    return { ok: false, assetPaths: [] };
  }
  const assetPaths = [...body.matchAll(ENV_APP_ASSET_REF_PATTERN)]
    .map((match) => String(match[1] ?? '').trim())
    .filter((value) => value !== '');
  return {
    ok: assetPaths.length > 0,
    assetPaths: [...new Set(assetPaths)],
  };
}

function contentTypeAllowsHTML(headers: http.IncomingHttpHeaders): boolean {
  const value = String(headers['content-type'] ?? '').trim().toLowerCase();
  return value === '' || value.includes('text/html');
}

function invalidEnvAppShellStatus(status: RuntimeProbeStatus): RuntimeProbeStatus {
  if (!status.runtime_service) {
    return status;
  }
  return {
    ...status,
    runtime_service: normalizeRuntimeServiceSnapshot({
      ...status.runtime_service,
      open_readiness: envAppShellUnavailableOpenReadiness(),
    }),
  };
}

function startingEnvAppShellStatus(status: RuntimeProbeStatus): RuntimeProbeStatus {
  if (!status.runtime_service) {
    return status;
  }
  return {
    ...status,
    runtime_service: normalizeRuntimeServiceSnapshot({
      ...status.runtime_service,
      open_readiness: {
        state: 'starting',
        reason_code: 'env_app_shell_unreachable',
        message: 'Environment App shell is not reachable yet.',
      },
    }),
  };
}

async function probeEnvAppShell(
  baseURL: string,
  options: Required<Pick<RuntimeProbeOptions, 'timeoutMs'>> & Pick<RuntimeProbeOptions, 'signal'>,
): Promise<EnvAppShellProbeOutcome> {
  const deadline = Date.now() + options.timeoutMs;
  const shellResponse = await request(new URL('/_redeven_proxy/env/', baseURL), {
    timeoutMs: Math.max(1, deadline - Date.now()),
    signal: options.signal,
    accept: 'text/html;q=1.0,*/*;q=0.5',
  });
  if (!shellResponse.ok && shellResponse.failure.kind !== 'invalid_response') {
    return { result: 'unavailable' };
  }
  if (!shellResponse.ok || shellResponse.value.statusCode !== 200 || !contentTypeAllowsHTML(shellResponse.value.headers)) {
    return { result: 'invalid' };
  }
  const validation = validateEnvAppShellHTML(shellResponse.value.body);
  if (!validation.ok) {
    return { result: 'invalid' };
  }
  const assetFingerprint = validation.assetPaths.join('\n');
  const assetResponses = await Promise.all(validation.assetPaths.map((assetPath) => {
    const assetURL = new URL(assetPath, baseURL);
    return request(assetURL, {
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal: options.signal,
      method: 'HEAD',
      accept: '*/*',
    });
  }));
  if (assetResponses.some((response) => !response.ok && response.failure.kind !== 'invalid_response')) {
    return { result: 'unavailable', assetFingerprint };
  }
  if (assetResponses.some((response) => !response.ok || response.value.statusCode !== 200)) {
    return { result: 'invalid', assetFingerprint };
  }
  return { result: 'ready', assetFingerprint };
}

function envAppShellRuntimeIdentity(baseURL: string, status: RuntimeProbeStatus): string {
  return [
    baseURL,
    status.started_at_unix_ms ?? 0,
    status.runtime_service?.runtime_version ?? '',
    status.runtime_service?.runtime_commit ?? '',
    status.runtime_service?.runtime_build_time ?? '',
  ].join('|');
}

function envAppShellProbeCacheKey(runtimeIdentity: string, assetFingerprint: string): string {
  return `${runtimeIdentity}|${assetFingerprint}`;
}

function rememberEnvAppShellSuccess(
  baseURL: string,
  runtimeIdentity: string,
  assetFingerprint: string,
): void {
  const baseURLPrefix = `${baseURL}|`;
  for (const [identity, previousFingerprint] of envAppShellFingerprintByRuntimeIdentity) {
    if (identity !== runtimeIdentity && identity.startsWith(baseURLPrefix)) {
      envAppShellFingerprintByRuntimeIdentity.delete(identity);
      envAppShellSuccessCache.delete(envAppShellProbeCacheKey(identity, previousFingerprint));
    }
  }
  envAppShellFingerprintByRuntimeIdentity.set(runtimeIdentity, assetFingerprint);
  envAppShellSuccessCache.add(envAppShellProbeCacheKey(runtimeIdentity, assetFingerprint));
}

async function probeEnvAppShellCached(
  baseURL: string,
  status: RuntimeProbeStatus,
  options: Required<Pick<RuntimeProbeOptions, 'timeoutMs'>> & Pick<RuntimeProbeOptions, 'signal'>,
): Promise<EnvAppShellProbeResult> {
  const runtimeIdentity = envAppShellRuntimeIdentity(baseURL, status);
  const cachedFingerprint = envAppShellFingerprintByRuntimeIdentity.get(runtimeIdentity);
  if (cachedFingerprint) {
    if (envAppShellSuccessCache.has(envAppShellProbeCacheKey(runtimeIdentity, cachedFingerprint))) {
      return 'ready';
    }
    envAppShellFingerprintByRuntimeIdentity.delete(runtimeIdentity);
  }
  const outcome = await probeEnvAppShell(baseURL, options);
  if (outcome.result === 'ready' && outcome.assetFingerprint) {
    rememberEnvAppShellSuccess(baseURL, runtimeIdentity, outcome.assetFingerprint);
  }
  return outcome.result;
}

async function applyEnvAppShellReadiness(
  baseURL: string,
  status: RuntimeProbeStatus,
  options: Required<Pick<RuntimeProbeOptions, 'timeoutMs'>> & Pick<RuntimeProbeOptions, 'signal'>,
): Promise<RuntimeProbeStatus> {
  if (!runtimeServiceIsOpenable(status.runtime_service)) {
    return status;
  }
  const shellProbe = await probeEnvAppShellCached(baseURL, status, options);
  if (shellProbe === 'ready') {
    return status;
  }
  return shellProbe === 'invalid'
    ? invalidEnvAppShellStatus(status)
    : startingEnvAppShellStatus(status);
}

function startupReportFromProbeStatus(baseURL: string, status: RuntimeProbeStatus): StartupReport {
  return {
    local_ui_url: baseURL,
    local_ui_urls: [baseURL],
    password_required: status.password_required,
    ...(typeof status.desktop_managed === 'boolean' ? { desktop_managed: status.desktop_managed } : {}),
    ...(String(status.desktop_owner_id ?? '').trim() !== '' ? { desktop_owner_id: String(status.desktop_owner_id).trim() } : {}),
    ...(status.started_at_unix_ms ? { started_at_unix_ms: status.started_at_unix_ms } : {}),
    ...(status.runtime_service ? { runtime_service: status.runtime_service } : {}),
  };
}

function probeStatusFromStartup(startup: StartupReport): RuntimeProbeStatus {
  return {
    status: 'online',
    password_required: startup.password_required === true,
    ...(typeof startup.desktop_managed === 'boolean' ? { desktop_managed: startup.desktop_managed } : {}),
    ...(String(startup.desktop_owner_id ?? '').trim() !== '' ? { desktop_owner_id: String(startup.desktop_owner_id).trim() } : {}),
    ...(startup.started_at_unix_ms ? { started_at_unix_ms: startup.started_at_unix_ms } : {}),
    ...(startup.runtime_service ? { runtime_service: startup.runtime_service } : {}),
  };
}

function normalizedProbeOptions(options: RuntimeProbeOptions): Required<Pick<RuntimeProbeOptions, 'timeoutMs'>> & Pick<RuntimeProbeOptions, 'signal'> {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_RUNTIME_PROBE_TIMEOUT_MS);
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

export async function probeExternalLocalUIHealth(
  baseURL: string,
  options: RuntimeProbeOptions = {},
): Promise<RuntimeProbeResult<StartupReport>> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(baseURL);
  const result = await probeRedevenLocalUIHealth(normalizedBaseURL, normalizedProbeOptions(options));
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: startupReportFromProbeStatus(normalizedBaseURL, result.value) };
}

export async function validateExternalLocalUIShell(
  startup: StartupReport,
  options: RuntimeProbeOptions = {},
): Promise<StartupReport> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(startup.local_ui_url);
  const status = await applyEnvAppShellReadiness(
    normalizedBaseURL,
    probeStatusFromStartup(startup),
    normalizedProbeOptions(options),
  );
  return {
    ...startup,
    ...startupReportFromProbeStatus(normalizedBaseURL, status),
  };
}

export async function probeExternalLocalUIStartup(
  baseURL: string,
  options: RuntimeProbeOptions = {},
): Promise<RuntimeProbeResult<StartupReport>> {
  const result = await probeExternalLocalUIHealth(baseURL, options);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    value: await validateExternalLocalUIShell(result.value, options),
  };
}
