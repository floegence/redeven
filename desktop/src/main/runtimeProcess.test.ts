import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DesktopOperationFailureError } from './desktopOperationFailure';
import { launchStartedFreshManagedRuntime, startManagedRuntime } from './runtimeProcess';
import { parseStartupReport } from './startup';

function runtimeStatusPayload(
  baseURL: string,
  readiness: 'starting' | 'openable' = 'openable',
  runtimeServiceOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const activeWorkload = runtimeServiceOverrides.active_workload
    && typeof runtimeServiceOverrides.active_workload === 'object'
    ? runtimeServiceOverrides.active_workload
    : {};
  const compatibility = typeof runtimeServiceOverrides.compatibility === 'string'
    ? runtimeServiceOverrides.compatibility
    : 'compatible';
  const openReadiness = runtimeServiceOverrides.open_readiness
    ?? (readiness === 'openable'
      ? { state: 'openable' }
      : { state: 'starting', reason_code: 'env_app_gateway_starting', message: 'Env App gateway is starting.' });
  return {
    status: 'ready',
    local_ui_url: baseURL,
    local_ui_urls: [baseURL],
    password_required: false,
    effective_run_mode: 'local',
    remote_enabled: false,
    desktop_managed: true,
    desktop_owner_id: 'desktop-owner-1',
    diagnostics_enabled: true,
    pid: process.pid,
    runtime_service: {
      protocol_version: 'redeven-runtime-v1',
      service_owner: 'desktop',
      desktop_managed: true,
      effective_run_mode: 'local',
      remote_enabled: false,
      ...runtimeServiceOverrides,
      compatibility,
      open_readiness: openReadiness,
      active_workload: activeWorkload,
    },
  };
}

async function writeJSON(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeFakeRuntimeExecutable(dir: string): Promise<string> {
  const scriptPath = path.join(dir, 'fake-runtime.cjs');
  await fs.writeFile(scriptPath, `#!/usr/bin/env node
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

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const statusFile = process.env.REDEVEN_TEST_STATUS_FILE;
const counterFile = process.env.REDEVEN_TEST_STATUS_COUNTER_FILE;

if (process.argv[2] === 'desktop-runtime-status') {
  if (!statusFile || !fs.existsSync(statusFile)) {
    process.stdout.write(JSON.stringify({ status: 'blocked', code: 'not_running', message: 'Runtime daemon is not running.' }) + '\\n');
    process.exit(0);
  }
  if (counterFile) {
    const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) || 0 : 0;
    fs.writeFileSync(counterFile, String(count + 1));
    const payload = readJSON(statusFile);
    if (process.env.REDEVEN_TEST_RUNTIME_MODE === 'attach_existing_update_required' && count === 0) {
      process.stdout.write(JSON.stringify({ status: 'blocked', code: 'not_running', message: 'Runtime daemon is not running.' }) + '\\n');
      process.exit(0);
    }
    if (count >= 2 && payload.runtime_service) {
      payload.runtime_service.open_readiness = { state: 'openable' };
      writeJSON(statusFile, payload);
      process.stdout.write(JSON.stringify(payload) + '\\n');
      process.exit(0);
    }
  }
  process.stdout.write(fs.readFileSync(statusFile, 'utf8'));
  process.exit(0);
}

if (process.env.REDEVEN_TEST_RUNTIME_MODE === 'attach_existing_update_required') {
  process.exit(0);
}

const reportFile = argValue('--startup-report-file');
const mode = process.env.REDEVEN_TEST_RUNTIME_MODE || 'openable';
if (mode === 'stderr_exit') {
  process.stderr.write('runtime stderr detail that should stay diagnostic\\n');
  process.exit(42);
}
const server = http.createServer((request, response) => {
  if (request.url === '/_redeven_proxy/env/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>');
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
  const payload = ${runtimeStatusPayload.toString()}(baseURL, mode === 'starting_then_openable' ? 'starting' : 'openable');
  payload.pid = process.pid;
  if (statusFile) {
    writeJSON(statusFile, payload);
  }
  writeJSON(reportFile, payload);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
`, 'utf8');
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

describe('runtimeProcess', () => {
  it('parses the startup report payload returned by the bundled runtime', () => {
    expect(parseStartupReport(JSON.stringify({
      local_ui_url: 'http://127.0.0.1:43123/',
      local_ui_urls: ['http://127.0.0.1:43123/'],
      runtime_control: {
        protocol_version: 'redeven-runtime-control-v1',
        base_url: 'http://127.0.0.1:43124',
        token: 'rtctl_test',
        desktop_owner_id: 'desktop-owner-1',
        expires_at_unix_ms: 1778750000000,
      },
      password_required: true,
      effective_run_mode: 'hybrid',
      remote_enabled: true,
      desktop_managed: true,
      desktop_owner_id: 'desktop-owner-1',
      started_at_unix_ms: 1778751234567,
    }))).toMatchObject({
      local_ui_url: 'http://127.0.0.1:43123/',
      runtime_control: {
        protocol_version: 'redeven-runtime-control-v1',
        base_url: 'http://127.0.0.1:43124',
        token: 'rtctl_test',
      },
      password_required: true,
      started_at_unix_ms: 1778751234567,
    });
  });

  it('reuses an existing runtime reported by the runtime status command', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    try {
      await writeJSON(statusFile, runtimeStatusPayload('http://127.0.0.1:43123/'));
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: [],
        env: { REDEVEN_TEST_STATUS_FILE: statusFile },
        runtimeAttachTimeoutMs: 5_000,
        desktopOwnerID: 'desktop-owner-1',
      });
      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.spawned).toBe(false);
      expect(launch.managedRuntime.attached).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses an existing local runtime even when its bundled identity differs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    try {
      await writeJSON(statusFile, runtimeStatusPayload('http://127.0.0.1:43123/', 'openable', {
        runtime_version: 'v0.5.9',
        runtime_commit: 'old-runtime',
        runtime_build_time: '2026-01-01T00:00:00Z',
      }));
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: [],
        env: { REDEVEN_TEST_STATUS_FILE: statusFile },
        runtimeAttachTimeoutMs: 5_000,
        desktopOwnerID: 'desktop-owner-1',
      });
      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.spawned).toBe(false);
      expect(launch.managedRuntime.attached).toBe(true);
      expect(launch.managedRuntime.startup.runtime_service?.runtime_commit).toBe('old-runtime');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses an existing local runtime that reports a compatibility update block', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    try {
      await writeJSON(statusFile, runtimeStatusPayload('http://127.0.0.1:43123/', 'openable', {
        compatibility: 'update_required',
        runtime_version: 'v0.5.9',
        open_readiness: {
          state: 'blocked',
          reason_code: 'runtime_update_required',
          message: 'Redeven Desktop has a newer bundled runtime.',
        },
      }));
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: [],
        env: { REDEVEN_TEST_STATUS_FILE: statusFile },
        runtimeAttachTimeoutMs: 5_000,
        desktopOwnerID: 'desktop-owner-1',
      });
      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.spawned).toBe(false);
      expect(launch.managedRuntime.attached).toBe(true);
      expect(launch.managedRuntime.startup.runtime_service?.compatibility).toBe('update_required');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reuses an attached local runtime that reports a compatibility update block after launch handoff', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const counterFile = path.join(dir, 'status-count.txt');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    try {
      await writeJSON(statusFile, runtimeStatusPayload('http://127.0.0.1:43123/', 'openable', {
        compatibility: 'update_required',
        runtime_version: 'v0.5.9',
        open_readiness: {
          state: 'blocked',
          reason_code: 'runtime_update_required',
          message: 'Redeven Desktop has a newer bundled runtime.',
        },
      }));
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: [],
        env: {
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_STATUS_COUNTER_FILE: counterFile,
          REDEVEN_TEST_RUNTIME_MODE: 'attach_existing_update_required',
        },
        tempRoot: dir,
        startupTimeoutMs: 500,
        runtimeAttachTimeoutMs: 5_000,
        desktopOwnerID: 'desktop-owner-1',
      });
      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launch.spawned).toBe(true);
      expect(launch.managedRuntime.attached).toBe(true);
      expect(launch.managedRuntime.startup.runtime_service?.compatibility).toBe('update_required');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('waits for a spawned runtime to become openable through the runtime status command', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const counterFile = path.join(dir, 'status-count.txt');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    const progressPhases: string[] = [];
    try {
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: [],
        env: {
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_STATUS_COUNTER_FILE: counterFile,
          REDEVEN_TEST_RUNTIME_MODE: 'starting_then_openable',
        },
        tempRoot: dir,
        runtimeAttachTimeoutMs: 5_000,
        runtimeStabilityWindowMs: 40,
        runtimeStabilityPollMs: 20,
        onProgress: (progress) => progressPhases.push(progress.phase),
      });
      expect(launch.kind).toBe('ready');
      if (launch.kind !== 'ready') {
        return;
      }
      expect(launchStartedFreshManagedRuntime(launch)).toBe(true);
      expect(launch.managedRuntime.startup.runtime_service?.open_readiness).toEqual({ state: 'openable' });
      expect(progressPhases).toEqual([
        'checking_existing_runtime',
        'starting_runtime',
        'waiting_for_readiness',
        'runtime_ready',
      ]);
      await launch.managedRuntime.stop();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps local runtime stderr as diagnostics instead of the visible failure summary', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const executablePath = await writeFakeRuntimeExecutable(dir);
    try {
      try {
        await startManagedRuntime({
          executablePath,
          runtimeArgs: [],
          env: { REDEVEN_TEST_RUNTIME_MODE: 'stderr_exit' },
          tempRoot: dir,
          startupTimeoutMs: 5_000,
          runtimeAttachTimeoutMs: 100,
          desktopOwnerID: 'desktop-owner-1',
        });
        throw new Error('expected runtime startup failure');
      } catch (error) {
        expect(error).toBeInstanceOf(DesktopOperationFailureError);
        const failure = (error as DesktopOperationFailureError).presentation;
        expect(failure.summary).toBe('redeven exited before reporting readiness (exit code: 42)');
        expect(failure.summary).not.toContain('stderr:');
        expect(failure.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({
            channel: 'stderr',
            label: 'Runtime stderr',
            text: 'runtime stderr detail that should stay diagnostic',
          }),
        ]));
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
