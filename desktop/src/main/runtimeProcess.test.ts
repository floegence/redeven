import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { launchStartedFreshManagedRuntime, startManagedRuntime } from './runtimeProcess';
import { parseStartupReport } from './startup';

const validEnvAppShellHTML = '<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>';

async function writeJSONFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runtimeStatePayload(baseURL: string, pid: number = process.pid): Record<string, unknown> {
  return {
    local_ui_url: baseURL,
    local_ui_urls: [baseURL],
    password_required: false,
    effective_run_mode: 'local',
    remote_enabled: false,
    desktop_managed: true,
    desktop_owner_id: 'desktop-owner-1',
    diagnostics_enabled: true,
    pid,
    runtime_service: {
      protocol_version: 'redeven-runtime-v1',
      service_owner: 'desktop',
      desktop_managed: true,
      effective_run_mode: 'local',
      remote_enabled: false,
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    },
  };
}

async function writeRuntimeState(runtimeStateFile: string, baseURL: string): Promise<void> {
  await writeJSONFile(runtimeStateFile, runtimeStatePayload(baseURL));
}

function startHealthServer(options: Readonly<{
  readinessStates?: readonly ('starting' | 'openable' | 'blocked')[];
}> = {}): Promise<Readonly<{
  baseURL: string;
  close: () => Promise<void>;
  healthRequests: () => number;
}>> {
  return new Promise((resolve, reject) => {
    let healthRequests = 0;
    const readinessStates = [...(options.readinessStates ?? ['openable'])];
    const server = http.createServer((request, response) => {
      if (request.url === '/api/local/runtime/health') {
        healthRequests += 1;
        const readinessState = readinessStates[Math.min(healthRequests - 1, readinessStates.length - 1)] ?? 'openable';
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          data: {
            status: 'online',
              password_required: false,
              desktop_managed: true,
              desktop_owner_id: 'desktop-owner-1',
              runtime_service: {
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'local',
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: readinessState === 'openable'
                ? { state: 'openable' }
                : {
                    state: readinessState,
                    reason_code: readinessState === 'blocked' ? 'runtime_update_required' : 'env_app_gateway_starting',
                    message: readinessState === 'blocked'
                      ? 'Update the runtime before opening this environment.'
                      : 'Env App gateway is starting.',
                  },
              active_workload: {},
            },
          },
        }));
        return;
      }
      if (request.url === '/_redeven_proxy/env/') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(validEnvAppShellHTML);
        return;
      }
      if (request.url === '/_redeven_proxy/env/assets/index.js') {
        response.writeHead(200, { 'content-type': 'application/javascript' });
        response.end(request.method === 'HEAD' ? undefined : 'console.log("env");');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('test server did not receive a TCP address'));
        return;
      }
      resolve({
        baseURL: `http://127.0.0.1:${address.port}/`,
        close: async () => {
          await new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          });
        },
        healthRequests: () => healthRequests,
      });
    });
  });
}

async function writeFakeRuntimeScript(dir: string): Promise<string> {
  const scriptPath = path.join(dir, 'fake-runtime.cjs');
  await fs.writeFile(scriptPath, `
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n');
}

const runtimeStateFile = process.env.REDEVEN_TEST_RUNTIME_STATE_FILE || '';
const mode = process.env.REDEVEN_TEST_RUNTIME_MODE || 'stable';
const reportFile = argValue('--startup-report-file');
let healthRequests = 0;

const server = http.createServer((request, response) => {
  if (request.url === '/api/local/runtime/health') {
    healthRequests += 1;
    const readinessState = mode === 'starting_then_openable' && healthRequests < 3 ? 'starting' : 'openable';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: {
      status: 'online',
      password_required: false,
      runtime_service: {
        protocol_version: 'redeven-runtime-v1',
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'local',
        remote_enabled: false,
        compatibility: 'compatible',
        open_readiness: readinessState === 'openable'
          ? { state: 'openable' }
          : { state: 'starting', reason_code: 'env_app_gateway_starting', message: 'Env App gateway is starting.' },
        active_workload: {},
      },
    } }));
    if (mode === 'exit_after_first_health' && healthRequests === 1) {
      setImmediate(() => {
        server.close(() => process.exit(0));
      });
    }
    return;
  }
  if (request.url === '/_redeven_proxy/env/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('${validEnvAppShellHTML}');
    return;
  }
  if (request.url === '/_redeven_proxy/env/assets/index.js') {
    response.writeHead(200, { 'content-type': 'application/javascript' });
    response.end(request.method === 'HEAD' ? undefined : 'console.log("env");');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{}');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const baseURL = 'http://127.0.0.1:' + address.port + '/';
  const payload = {
    status: 'ready',
    local_ui_url: baseURL,
    local_ui_urls: [baseURL],
    password_required: false,
    effective_run_mode: 'local',
    remote_enabled: false,
    desktop_managed: true,
    diagnostics_enabled: true,
    pid: process.pid,
    runtime_service: {
      protocol_version: 'redeven-runtime-v1',
      service_owner: 'desktop',
      desktop_managed: true,
      effective_run_mode: 'local',
      remote_enabled: false,
      compatibility: 'compatible',
      open_readiness: { state: mode === 'starting_then_openable' ? 'starting' : 'openable', reason_code: mode === 'starting_then_openable' ? 'env_app_gateway_starting' : undefined },
      active_workload: {},
    },
  };
  writeJSON(runtimeStateFile, payload);
  writeJSON(reportFile, payload);
  if (mode === 'exit') {
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, 40);
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
`, 'utf8');
  return scriptPath;
}

describe('runtimeProcess', () => {
  it('parses the startup report payload returned by the bundled runtime', () => {
    expect(parseStartupReport(JSON.stringify({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      desktop_owner_id: undefined,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
      pid: 4242,
      runtime_service: {
        runtime_version: 'v1.2.3',
        protocol_version: 'redeven-runtime-v1',
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        compatibility: 'compatible',
        open_readiness: { state: 'openable' },
        active_workload: {
          terminal_count: 2,
          session_count: 1,
          task_count: 0,
          port_forward_count: 3,
        },
      },
    }))).toEqual({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      state_dir: '/Users/tester/.redeven',
      diagnostics_enabled: true,
      pid: 4242,
      runtime_service: {
        runtime_version: 'v1.2.3',
        runtime_commit: undefined,
        runtime_build_time: undefined,
        protocol_version: 'redeven-runtime-v1',
        compatibility_epoch: undefined,
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        compatibility: 'compatible',
        compatibility_message: undefined,
        minimum_desktop_version: undefined,
        minimum_runtime_version: undefined,
        compatibility_review_id: undefined,
        open_readiness: { state: 'openable' },
        active_workload: {
          terminal_count: 2,
          session_count: 1,
          task_count: 0,
          port_forward_count: 3,
        },
      },
    });
  });

  it('rejects startup reports without a local ui url', () => {
    expect(() => parseStartupReport('{}')).toThrow('startup report missing local_ui_url');
  });

  it('treats attached launches as not freshly managed even after a spawn attempt', () => {
    expect(launchStartedFreshManagedRuntime({
      kind: 'ready',
      spawned: true,
      managedRuntime: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          password_required: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
          pid: 4242,
        },
        reportDir: null,
        reportFile: null,
        attached: true,
        stop: async () => undefined,
      },
    })).toBe(false);

    expect(launchStartedFreshManagedRuntime({
      kind: 'ready',
      spawned: true,
      managedRuntime: {
        child: null,
        startup: {
          local_ui_url: 'http://127.0.0.1:43123/',
          local_ui_urls: ['http://127.0.0.1:43123/'],
          password_required: false,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          desktop_managed: true,
          pid: 4242,
        },
        reportDir: '/tmp/redeven',
        reportFile: '/tmp/redeven/startup.json',
        attached: false,
        stop: async () => undefined,
      },
    })).toBe(true);
  });

  it('does not apply the fresh-launch stability window to an existing runtime', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const runtimeStateFile = path.join(dir, 'runtime', 'local-ui.json');
    const server = await startHealthServer();
    try {
      await writeRuntimeState(runtimeStateFile, server.baseURL);

      const launch = await startManagedRuntime({
        executablePath: process.execPath,
        runtimeArgs: ['-e', 'process.exit(42)'],
        runtimeStateFile,
        runtimeAttachTimeoutMs: 200,
        runtimeStabilityWindowMs: 500,
        runtimeStabilityPollMs: 30,
        desktopOwnerID: 'desktop-owner-1',
      });

      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.spawned).toBe(false);
      expect(launch.managedRuntime.attached).toBe(true);
      expect(server.healthRequests()).toBe(1);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not report spawned runtime success when the process exits during readiness', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const runtimeStateFile = path.join(dir, 'runtime', 'local-ui.json');
    const scriptPath = await writeFakeRuntimeScript(dir);
    try {
      await expect(startManagedRuntime({
        executablePath: process.execPath,
        runtimeArgs: [scriptPath],
        env: {
          REDEVEN_TEST_RUNTIME_STATE_FILE: runtimeStateFile,
          REDEVEN_TEST_RUNTIME_MODE: 'exit_after_first_health',
        },
        runtimeStateFile,
        tempRoot: dir,
        runtimeAttachTimeoutMs: 120,
        runtimeStabilityWindowMs: 140,
        runtimeStabilityPollMs: 40,
      })).rejects.toThrow(/did not stay online|exited during startup readiness checks/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('waits for a spawned runtime to become openable after Local UI health is online', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const runtimeStateFile = path.join(dir, 'runtime', 'local-ui.json');
    const scriptPath = await writeFakeRuntimeScript(dir);
    try {
      const launch = await startManagedRuntime({
        executablePath: process.execPath,
        runtimeArgs: [scriptPath],
        env: {
          REDEVEN_TEST_RUNTIME_STATE_FILE: runtimeStateFile,
          REDEVEN_TEST_RUNTIME_MODE: 'starting_then_openable',
        },
        runtimeStateFile,
        tempRoot: dir,
        runtimeAttachTimeoutMs: 120,
        runtimeStabilityWindowMs: 80,
        runtimeStabilityPollMs: 40,
      });

      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.managedRuntime.startup.runtime_service?.open_readiness).toEqual({ state: 'openable' });
      await launch.managedRuntime.stop();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not attach an existing runtime until the runtime service says it is openable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const runtimeStateFile = path.join(dir, 'runtime', 'local-ui.json');
    const server = await startHealthServer({ readinessStates: ['starting'] });
    try {
      await writeRuntimeState(runtimeStateFile, server.baseURL);

      await expect(startManagedRuntime({
        executablePath: process.execPath,
        runtimeArgs: ['-e', 'process.exit(42)'],
        runtimeStateFile,
        runtimeAttachTimeoutMs: 200,
        runtimeStabilityWindowMs: 0,
        runtimeStabilityPollMs: 30,
        desktopOwnerID: 'desktop-owner-1',
      })).rejects.toThrow(/not ready to open yet|Env App gateway is starting/);
    } finally {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
