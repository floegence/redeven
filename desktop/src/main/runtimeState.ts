import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';

import { isAllowedAppNavigation } from './navigation';
import { parseStartupReport, type StartupReport } from './startup';
import { normalizeLocalUIBaseURL } from './localUIURL';
import { defaultManagedStateLayout } from './statePaths';

const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

type RuntimeProbeResponse = Readonly<{
  statusCode: number | null;
  body: string;
}>;

type RuntimeProbeStatus = Readonly<{
  status: 'online';
  password_required: boolean;
}>;

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

function request(url: URL, timeoutMs: number): Promise<RuntimeProbeResponse> {
  return new Promise((resolve) => {
    const requestImpl = url.protocol === 'https:' ? https.get : http.get;
    const request = requestImpl(url, {
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json;q=1.0,text/html;q=0.8,*/*;q=0.5',
      },
    }, (response) => {
      const statusCode = typeof response.statusCode === 'number' ? response.statusCode : null;
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode, body });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', () => resolve({ statusCode: null, body: '' }));
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
  return parseLocalRuntimeHealthResponse(response.body);
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
      return {
        ...startup,
        local_ui_url: candidateURL,
        local_ui_urls: candidateStartupURLs({
          ...startup,
          local_ui_url: candidateURL,
        }),
        password_required: status.password_required,
      };
    }
  }
  return null;
}
