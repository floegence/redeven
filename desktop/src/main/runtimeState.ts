import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { isAllowedAppNavigation } from './navigation';
import { parseStartupReport, type StartupReport } from './startup';

const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

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

function requestStatus(url: URL, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const request = http.get(url, {
      timeout: timeoutMs,
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    }, (response) => {
      const status = typeof response.statusCode === 'number' ? response.statusCode : null;
      response.resume();
      resolve(status);
    });

    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', () => resolve(null));
  });
}

async function probeStartupURL(baseURL: string, timeoutMs: number): Promise<boolean> {
  if (!isAllowedAppNavigation(baseURL, baseURL)) {
    return false;
  }
  const probeURL = new URL('/_redeven_proxy/env/', baseURL);
  const status = await requestStatus(probeURL, timeoutMs);
  return status !== null && status >= 200 && status < 400;
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
    if (await probeStartupURL(candidateURL, timeoutMs)) {
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
