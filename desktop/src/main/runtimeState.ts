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

const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

type RuntimeProbeResponse = Readonly<{
  statusCode: number | null;
  headers: http.IncomingHttpHeaders;
  body: string;
}>;

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
const envAppShellSuccessCache = new Map<string, Promise<EnvAppShellProbeResult>>();
const envAppShellProbeInFlight = new Map<string, Promise<EnvAppShellProbeResult>>();

function request(
  url: URL,
  timeoutMs: number,
  options: Readonly<{
    method?: 'GET' | 'HEAD';
    accept?: string;
  }> = {},
): Promise<RuntimeProbeResponse> {
  return new Promise((resolve) => {
    const requestImpl = url.protocol === 'https:' ? https.request : http.request;
    const request = requestImpl(url, {
      method: options.method ?? 'GET',
      timeout: timeoutMs,
      headers: {
        Accept: options.accept ?? 'application/json;q=1.0,text/html;q=0.8,*/*;q=0.5',
      },
    }, (response) => {
      const statusCode = typeof response.statusCode === 'number' ? response.statusCode : null;
      if (options.method === 'HEAD') {
        response.resume();
        response.on('end', () => {
          resolve({ statusCode, headers: response.headers, body: '' });
        });
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode, headers: response.headers, body });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', () => resolve({ statusCode: null, headers: {}, body: '' }));
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

async function probeRedevenLocalUIHealth(baseURL: string, timeoutMs: number): Promise<RuntimeProbeStatus | null> {
  if (!isAllowedAppNavigation(baseURL, baseURL)) {
    return null;
  }
  const probeURL = new URL('/api/local/runtime/health', baseURL);
  const response = await request(probeURL, timeoutMs);
  if (response.statusCode !== 200) {
    return null;
  }
  const status = parseLocalRuntimeHealthResponse(response.body);
  if (!status) {
    return null;
  }
  return status;
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

async function probeEnvAppShell(baseURL: string, timeoutMs: number): Promise<EnvAppShellProbeOutcome> {
  const deadline = Date.now() + timeoutMs;
  const shellResponse = await request(new URL('/_redeven_proxy/env/', baseURL), Math.max(1, deadline - Date.now()), {
    accept: 'text/html;q=1.0,*/*;q=0.5',
  });
  if (shellResponse.statusCode === null) {
    return { result: 'unavailable' };
  }
  if (shellResponse.statusCode !== 200 || !contentTypeAllowsHTML(shellResponse.headers)) {
    return { result: 'invalid' };
  }
  const validation = validateEnvAppShellHTML(shellResponse.body);
  if (!validation.ok) {
    return { result: 'invalid' };
  }
  const assetFingerprint = validation.assetPaths.join('\n');
  const assetResponses = await Promise.all(validation.assetPaths.map((assetPath) => {
    const assetURL = new URL(assetPath, baseURL);
    return request(assetURL, Math.max(1, deadline - Date.now()), {
      method: 'HEAD',
      accept: '*/*',
    });
  }));
  if (assetResponses.some((response) => response.statusCode === null)) {
    return { result: 'unavailable', assetFingerprint };
  }
  if (assetResponses.some((response) => response.statusCode !== 200)) {
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
  envAppShellSuccessCache.set(
    envAppShellProbeCacheKey(runtimeIdentity, assetFingerprint),
    Promise.resolve('ready'),
  );
}

async function probeEnvAppShellCached(
  baseURL: string,
  status: RuntimeProbeStatus,
  timeoutMs: number,
): Promise<EnvAppShellProbeResult> {
  const runtimeIdentity = envAppShellRuntimeIdentity(baseURL, status);
  const cachedFingerprint = envAppShellFingerprintByRuntimeIdentity.get(runtimeIdentity);
  if (cachedFingerprint) {
    const cached = envAppShellSuccessCache.get(envAppShellProbeCacheKey(runtimeIdentity, cachedFingerprint));
    if (cached) {
      return cached;
    }
    envAppShellFingerprintByRuntimeIdentity.delete(runtimeIdentity);
  }
  const inFlight = envAppShellProbeInFlight.get(runtimeIdentity);
  if (inFlight) {
    return inFlight;
  }
  const task = probeEnvAppShell(baseURL, timeoutMs).then((outcome) => {
    if (outcome.result === 'ready' && outcome.assetFingerprint) {
      rememberEnvAppShellSuccess(baseURL, runtimeIdentity, outcome.assetFingerprint);
    }
    return outcome.result;
  }).finally(() => {
    envAppShellProbeInFlight.delete(runtimeIdentity);
  });
  envAppShellProbeInFlight.set(runtimeIdentity, task);
  return task;
}

async function applyEnvAppShellReadiness(
  baseURL: string,
  status: RuntimeProbeStatus,
  timeoutMs: number,
): Promise<RuntimeProbeStatus> {
  if (!runtimeServiceIsOpenable(status.runtime_service)) {
    return status;
  }
  const shellProbe = await probeEnvAppShellCached(baseURL, status, timeoutMs);
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

export async function loadExternalLocalUIHealth(
  baseURL: string,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport | null> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(baseURL);
  const status = await probeRedevenLocalUIHealth(normalizedBaseURL, timeoutMs);
  if (!status) {
    return null;
  }
  return startupReportFromProbeStatus(normalizedBaseURL, status);
}

export async function validateExternalLocalUIShell(
  startup: StartupReport,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(startup.local_ui_url);
  const status = await applyEnvAppShellReadiness(
    normalizedBaseURL,
    probeStatusFromStartup(startup),
    timeoutMs,
  );
  return {
    ...startup,
    ...startupReportFromProbeStatus(normalizedBaseURL, status),
  };
}

export async function loadExternalLocalUIStartup(
  baseURL: string,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport | null> {
  const startup = await loadExternalLocalUIHealth(baseURL, timeoutMs);
  return startup ? validateExternalLocalUIShell(startup, timeoutMs) : null;
}
