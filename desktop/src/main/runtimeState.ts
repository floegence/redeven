import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';

import { isAllowedAppNavigation } from './navigation';
import { parseStartupReport, type StartupReport } from './startup';
import { normalizeLocalUIBaseURL } from './localUIURL';
import { defaultManagedStateLayout } from './statePaths';
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
  runtime_service?: RuntimeServiceSnapshot;
}>;

const PROVIDER_BINDING_STARTUP_FIELDS = [
  'controlplane_base_url',
  'controlplane_provider_id',
  'env_public_id',
] as const satisfies readonly (keyof StartupReport)[];

type EnvAppShellValidation = Readonly<{
  ok: boolean;
  assetPaths: readonly string[];
}>;

type EnvAppShellProbeResult = 'ready' | 'invalid' | 'unavailable';

const ENV_APP_ROOT_MOUNT_PATTERN = /<div\b[^>]*\bid\s*=\s*["']root["'][^>]*>/iu;
const ENV_APP_ASSET_REF_PATTERN = /\b(?:src|href)\s*=\s*["'](\/_redeven_proxy\/env\/assets\/[^"']+)["']/giu;

function candidateStartupURLs(startup: StartupReport): string[] {
  const seen = new Set<string>();
  const ordered = [startup.local_ui_url, ...startup.local_ui_urls];
  const out: string[] = [];
  for (const value of ordered) {
    const cleanValue = String(value ?? '').trim();
    if (!cleanValue || seen.has(cleanValue)) {
      continue;
    }
    seen.add(cleanValue);
    out.push(cleanValue);
  }
  return out;
}

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
      ...(data.runtime_service ? { runtime_service: normalizeRuntimeServiceSnapshot(data.runtime_service) } : {}),
    };
  } catch {
    return null;
  }
}

async function probeRedevenLocalUI(baseURL: string, timeoutMs: number): Promise<RuntimeProbeStatus | null> {
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
  return await applyEnvAppShellReadiness(baseURL, status, timeoutMs);
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

async function probeEnvAppShell(baseURL: string, timeoutMs: number): Promise<EnvAppShellProbeResult> {
  const shellResponse = await request(new URL('/_redeven_proxy/env/', baseURL), timeoutMs, {
    accept: 'text/html;q=1.0,*/*;q=0.5',
  });
  if (shellResponse.statusCode === null) {
    return 'unavailable';
  }
  if (shellResponse.statusCode !== 200 || !contentTypeAllowsHTML(shellResponse.headers)) {
    return 'invalid';
  }
  const validation = validateEnvAppShellHTML(shellResponse.body);
  if (!validation.ok) {
    return 'invalid';
  }
  for (const assetPath of validation.assetPaths) {
    const assetURL = new URL(assetPath, baseURL);
    const assetResponse = await request(assetURL, timeoutMs, {
      method: 'HEAD',
      accept: '*/*',
    });
    if (assetResponse.statusCode === null) {
      return 'unavailable';
    }
    if (assetResponse.statusCode !== 200) {
      return 'invalid';
    }
  }
  return 'ready';
}

async function applyEnvAppShellReadiness(
  baseURL: string,
  status: RuntimeProbeStatus,
  timeoutMs: number,
): Promise<RuntimeProbeStatus> {
  if (!runtimeServiceIsOpenable(status.runtime_service)) {
    return status;
  }
  const shellProbe = await probeEnvAppShell(baseURL, timeoutMs);
  if (shellProbe === 'ready') {
    return status;
  }
  return shellProbe === 'invalid'
    ? invalidEnvAppShellStatus(status)
    : startingEnvAppShellStatus(status);
}

export async function loadExternalLocalUIStartup(
  baseURL: string,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport | null> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(baseURL);
  const status = await probeRedevenLocalUI(normalizedBaseURL, timeoutMs);
  if (!status) {
    return null;
  }
  return {
    local_ui_url: normalizedBaseURL,
    local_ui_urls: [normalizedBaseURL],
    password_required: status.password_required,
    ...(status.runtime_service ? { runtime_service: status.runtime_service } : {}),
  };
}

export function defaultRuntimeStatePath(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return defaultManagedStateLayout(env, homedir).runtimeStateFile;
}

export async function loadAttachableRuntimeState(
  runtimeStateFile: string,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport | null> {
  const cleanPath = String(runtimeStateFile ?? '').trim();
  if (!cleanPath) {
    return null;
  }

  let raw = '';
  try {
    raw = await fs.readFile(cleanPath, 'utf8');
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let startup: StartupReport;
  try {
    startup = parseStartupReport(raw);
  } catch {
    return null;
  }

  for (const candidateURL of candidateStartupURLs(startup)) {
    const status = await probeRedevenLocalUI(candidateURL, timeoutMs);
      if (status) {
      const providerBindingFields = Object.fromEntries(
        PROVIDER_BINDING_STARTUP_FIELDS.flatMap((key) => (
          startup[key] ? [[key, startup[key]]] : []
        )),
      ) as Partial<StartupReport>;
      return {
        ...startup,
        ...providerBindingFields,
        local_ui_url: candidateURL,
        local_ui_urls: candidateStartupURLs({
          ...startup,
          local_ui_url: candidateURL,
        }),
        password_required: status.password_required,
        ...(status.runtime_service ? { runtime_service: status.runtime_service } : {}),
      };
    }
  }
  return null;
}
