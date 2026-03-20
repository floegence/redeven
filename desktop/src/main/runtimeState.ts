import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { isAllowedAppNavigation } from './navigation';
import { parseStartupReport, type StartupReport } from './startup';
import { normalizeLocalUIBaseURL } from './localUIURL';

const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

type RuntimeProbeResponse = Readonly<{
  statusCode: number | null;
  body: string;
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

function parseLocalAccessStatusResponse(raw: string): boolean {
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner = parsed?.data;
    if (!inner || typeof inner !== 'object') {
      return false;
    }
    const data = inner as Record<string, unknown>;
    return typeof data.password_required === 'boolean' && typeof data.unlocked === 'boolean';
  } catch {
    return false;
  }
}

async function probeRedevenLocalUI(baseURL: string, timeoutMs: number): Promise<boolean> {
  if (!isAllowedAppNavigation(baseURL, baseURL)) {
    return false;
  }
  const probeURL = new URL('/api/local/access/status', baseURL);
  const response = await request(probeURL, timeoutMs);
  return response.statusCode === 200 && parseLocalAccessStatusResponse(response.body);
}

export async function loadExternalLocalUIStartup(
  baseURL: string,
  timeoutMs: number = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<StartupReport | null> {
  const normalizedBaseURL = normalizeLocalUIBaseURL(baseURL);
  if (!await probeRedevenLocalUI(normalizedBaseURL, timeoutMs)) {
    return null;
  }
  return {
    local_ui_url: normalizedBaseURL,
    local_ui_urls: [normalizedBaseURL],
  };
}

export function defaultRuntimeStatePath(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const homeDir = String(env.HOME ?? '').trim() || String(homedir() ?? '').trim();
  if (!homeDir) {
    return path.resolve('runtime', 'local-ui.json');
  }
  return path.join(homeDir, '.redeven', 'runtime', 'local-ui.json');
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
    if (await probeRedevenLocalUI(candidateURL, timeoutMs)) {
      return {
        ...startup,
        local_ui_url: candidateURL,
        local_ui_urls: candidateStartupURLs({
          ...startup,
          local_ui_url: candidateURL,
        }),
      };
    }
  }
  return null;
}
