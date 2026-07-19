import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { DesktopOperationFailureError } from './desktopOperationFailure';
import { launchStartedFreshManagedRuntime, startManagedRuntime } from './runtimeProcess';
import {
  RuntimeProcessCommandError,
  runtimeProcessCommandErrorFromOutput,
} from './runtimeProcessInventory';
import { parseStartupReport } from './startup';

function runtimeStatusPayloadForEpoch(
  baseURL: string,
  readiness: 'starting' | 'openable',
  runtimeServiceOverrides: Record<string, unknown>,
  compatibilityEpoch: number,
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
      : { state: 'starting', reason_code: 'env_app_app_server_starting', message: 'Env App app server is starting.' });
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
      compatibility_epoch: compatibilityEpoch,
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

function runtimeStatusPayload(
  baseURL: string,
  readiness: 'starting' | 'openable' = 'openable',
  runtimeServiceOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return runtimeStatusPayloadForEpoch(
    baseURL,
    readiness,
    runtimeServiceOverrides,
    RUNTIME_SERVICE_COMPATIBILITY_EPOCH,
  );
}

async function writeJSON(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.stat(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() >= deadline) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processInventoryPayload(input: Readonly<{
  stateRoot: string;
  executablePath: string;
  authority: 'automatic' | 'confirmed_takeover' | 'blocked';
  ownerStatus?: 'current' | 'missing' | 'foreign';
  ownerID?: string;
  pid?: number;
}>): Record<string, unknown> {
  const automatic = input.authority === 'automatic';
  const confirmedTakeover = input.authority === 'confirmed_takeover';
  const blocked = input.authority === 'blocked';
  const ownerStatus = input.ownerStatus ?? (automatic ? 'current' : confirmedTakeover ? 'foreign' : 'missing');
  return {
    schema_version: 2,
    scope: {
      runtime_root: input.stateRoot,
      state_root: input.stateRoot,
      desktop_owner_id: 'desktop-owner-1',
      user_identity: 'tester',
    },
    inventory_digest: 'a'.repeat(64),
    instances: [{
      pid: input.pid ?? 999_999,
      process_started_at_unix_ms: 1000,
      desktop_owner_id: input.ownerID,
      state_root: input.stateRoot,
      executable_path: input.executablePath,
      executable_device: 1,
      executable_inode: 2,
      identity_status: blocked ? 'incomplete' : 'verified',
      owner_status: ownerStatus,
      layout_status: blocked ? 'unknown' : 'current',
      owner_evidence: input.ownerID ? 'process_environment' : 'missing',
      stop_authority: input.authority,
      ...(!automatic ? { reason_code: confirmedTakeover ? 'runtime_owned_by_another_desktop' : 'runtime_identity_incomplete' } : {}),
    }],
    summary: {
      automatic: automatic ? 1 : 0,
      confirmed_takeover: confirmedTakeover ? 1 : 0,
      blocked: blocked ? 1 : 0,
    },
  };
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
const inventoryFile = process.env.REDEVEN_TEST_PROCESS_INVENTORY_FILE;

function emptyInventory() {
  return {
    schema_version: 2,
    scope: {
      runtime_root: argValue('--runtime-root') || argValue('--state-root') || process.cwd(),
      state_root: argValue('--state-root') || process.cwd(),
      desktop_owner_id: argValue('--desktop-owner-id') || undefined,
      user_identity: process.env.USER || 'tester',
    },
    inventory_digest: 'b'.repeat(64),
    instances: [],
    summary: { automatic: 0, confirmed_takeover: 0, blocked: 0 },
  };
}

function readInventory() {
  if (!inventoryFile || !fs.existsSync(inventoryFile)) return emptyInventory();
  return readJSON(inventoryFile);
}

if (process.argv[2] === 'desktop-runtime-inventory') {
  process.stdout.write(JSON.stringify(readInventory()) + '\\n');
  process.exit(0);
}

if (process.argv[2] === 'desktop-runtime-stop') {
  const before = readInventory();
  const expectedDigest = argValue('--expected-inventory-digest');
  if (expectedDigest !== before.inventory_digest) {
    process.stdout.write(JSON.stringify({ schema_version: before.schema_version, error: { code: 'runtime_inventory_changed', message: 'runtime process inventory changed before stop' } }) + '\\n');
    process.exit(1);
  }
  for (const instance of before.instances || []) {
    try { process.kill(Number(instance.pid), 'SIGINT'); } catch {}
  }
  if (inventoryFile) fs.rmSync(inventoryFile, { force: true });
  if (statusFile) fs.rmSync(statusFile, { force: true });
  const after = emptyInventory();
  process.stdout.write(JSON.stringify({ schema_version: before.schema_version, before, after, stopped: before.instances || [] }) + '\\n');
  process.exit(0);
}

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

const startupInputFile = process.env.REDEVEN_TEST_STARTUP_INPUT_FILE;
let startupInput = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { startupInput += chunk; });
process.stdin.on('end', () => {
  if (startupInputFile) {
    writeJSON(startupInputFile, {
      stdin: startupInput,
      secret_env: {
        local_ui_password: process.env.REDEVEN_LOCAL_UI_PASSWORD || '',
        bootstrap_ticket: process.env.REDEVEN_BOOTSTRAP_TICKET || '',
        legacy_desktop_ticket: process.env.REDEVEN_DESKTOP_BOOTSTRAP_TICKET || '',
      },
    });
  }
});

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
  const payload = ${runtimeStatusPayloadForEpoch.toString()}(
    baseURL,
    mode === 'starting_then_openable' ? 'starting' : 'openable',
    {},
    ${RUNTIME_SERVICE_COMPATIBILITY_EPOCH},
  );
  payload.pid = process.pid;
  if (statusFile) {
    writeJSON(statusFile, payload);
  }
  if (inventoryFile) {
    writeJSON(inventoryFile, {
      schema_version: 2,
      scope: { runtime_root: argValue('--state-root') || process.cwd(), state_root: argValue('--state-root') || process.cwd(), desktop_owner_id: process.env.REDEVEN_DESKTOP_OWNER_ID || 'desktop-owner-1', user_identity: process.env.USER || 'tester' },
      inventory_digest: 'a'.repeat(64),
      instances: [{ pid: process.pid, process_started_at_unix_ms: Date.now(), desktop_owner_id: process.env.REDEVEN_DESKTOP_OWNER_ID || 'desktop-owner-1', state_root: argValue('--state-root') || process.cwd(), executable_path: process.argv[1], executable_device: 1, executable_inode: process.pid + 1000, identity_status: 'verified', owner_status: 'current', layout_status: 'current', owner_evidence: 'process_environment', stop_authority: 'automatic' }],
      summary: { automatic: 1, confirmed_takeover: 0, blocked: 0 },
    });
  }
  if (mode === 'delayed_report') {
    setTimeout(() => writeJSON(reportFile, payload), 5_000);
  } else {
    writeJSON(reportFile, payload);
  }
});

function stopRuntime() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', stopRuntime);
process.on('SIGTERM', stopRuntime);
`, 'utf8');
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

describe('runtimeProcess', () => {
  it('preserves structured runtime inventory command conflicts', () => {
    const error = runtimeProcessCommandErrorFromOutput(
      JSON.stringify({
        schema_version: 2,
        error: {
          code: 'runtime_inventory_changed',
          message: 'runtime process inventory changed before stop',
        },
      }),
      '',
      'fallback',
    );

    expect(error).toBeInstanceOf(RuntimeProcessCommandError);
    expect(error).toMatchObject({
      code: 'runtime_inventory_changed',
      message: 'runtime process inventory changed before stop',
    });
  });

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

  it('blocks Start when a local Runtime process has incomplete identity', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const stateRoot = path.join(dir, 'state');
    const inventoryFile = path.join(dir, 'inventory.json');
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    await writeJSON(inventoryFile, processInventoryPayload({
      stateRoot,
      executablePath,
      authority: 'blocked',
    }));
    try {
      await expect(startManagedRuntime({
        executablePath,
        runtimeArgs: ['--state-root', stateRoot],
        stateRoot,
        desktopOwnerID: 'desktop-owner-1',
        runtimeProcessIntent: 'start',
        env: {
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_PROCESS_INVENTORY_FILE: inventoryFile,
        },
        tempRoot: dir,
        runtimeAttachTimeoutMs: 5_000,
      })).rejects.toMatchObject({ name: 'RuntimeProcessIdentityBlockedError' });
      await expect(fs.stat(statusFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reconciles verified current-owner Runtime processes before Restart', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const stateRoot = path.join(dir, 'state');
    const inventoryFile = path.join(dir, 'inventory.json');
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    const progressPhases: string[] = [];
    await writeJSON(inventoryFile, processInventoryPayload({
      stateRoot,
      executablePath,
      authority: 'automatic',
      ownerStatus: 'current',
      ownerID: 'desktop-owner-1',
    }));
    let launch: Awaited<ReturnType<typeof startManagedRuntime>> | null = null;
    try {
      launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: ['--state-root', stateRoot],
        stateRoot,
        desktopOwnerID: 'desktop-owner-1',
        runtimeProcessIntent: 'restart',
        env: {
          REDEVEN_DESKTOP_OWNER_ID: 'desktop-owner-1',
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_PROCESS_INVENTORY_FILE: inventoryFile,
        },
        tempRoot: dir,
        runtimeAttachTimeoutMs: 5_000,
        runtimeStabilityWindowMs: 20,
        runtimeStabilityPollMs: 10,
        onProgress: (progress) => progressPhases.push(progress.phase),
      });
      expect(launch.kind).toBe('ready');
      expect(progressPhases).toEqual(expect.arrayContaining([
        'discovering_runtime_instances',
        'stopping_runtime_process',
        'verifying_runtime_inventory',
        'starting_runtime',
      ]));
      const inventory = JSON.parse(await fs.readFile(inventoryFile, 'utf8')) as { instances?: Array<{ pid?: number }> };
      expect(inventory.instances?.[0]?.pid).not.toBe(999_999);
    } finally {
      if (launch?.kind === 'ready') {
        await launch.managedRuntime.stop().catch(() => undefined);
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses Restart before signals when a local runtime belongs to another Desktop owner', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const stateRoot = path.join(dir, 'state');
    const inventoryFile = path.join(dir, 'inventory.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    await writeJSON(inventoryFile, processInventoryPayload({
      stateRoot,
      executablePath,
      authority: 'confirmed_takeover',
      ownerStatus: 'foreign',
      ownerID: 'another-owner',
    }));
    try {
      await expect(startManagedRuntime({
        executablePath,
        runtimeArgs: ['--state-root', stateRoot],
        stateRoot,
        desktopOwnerID: 'desktop-owner-1',
        runtimeProcessIntent: 'restart',
        env: { REDEVEN_TEST_PROCESS_INVENTORY_FILE: inventoryFile },
        tempRoot: dir,
      })).rejects.toMatchObject({ name: 'RuntimeProcessTakeoverRequiredError' });
      await expect(fs.stat(inventoryFile)).resolves.toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('restarts a verified foreign local Runtime only with matching takeover confirmation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const stateRoot = path.join(dir, 'state');
    const inventoryFile = path.join(dir, 'inventory.json');
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    await writeJSON(inventoryFile, processInventoryPayload({
      stateRoot,
      executablePath,
      authority: 'confirmed_takeover',
      ownerStatus: 'foreign',
      ownerID: 'another-owner',
    }));
    let launch: Awaited<ReturnType<typeof startManagedRuntime>> | null = null;
    try {
      launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: ['--state-root', stateRoot],
        stateRoot,
        desktopOwnerID: 'desktop-owner-1',
        runtimeProcessIntent: 'restart',
        runtimeProcessReconciliation: {
          mode: 'confirmed_takeover',
          expected_inventory_digest: 'a'.repeat(64),
        },
        env: {
          REDEVEN_DESKTOP_OWNER_ID: 'desktop-owner-1',
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_PROCESS_INVENTORY_FILE: inventoryFile,
        },
        tempRoot: dir,
        runtimeAttachTimeoutMs: 5_000,
        runtimeStabilityWindowMs: 20,
        runtimeStabilityPollMs: 10,
      });
      expect(launch.kind).toBe('ready');
      const finalInventory = JSON.parse(await fs.readFile(inventoryFile, 'utf8')) as { instances?: Array<{ desktop_owner_id?: string }> };
      expect(finalInventory.instances?.[0]?.desktop_owner_id).toBe('desktop-owner-1');
    } finally {
      if (launch?.kind === 'ready') {
        await launch.managedRuntime.stop().catch(() => undefined);
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes one Desktop secrets envelope and strips secret environment variables', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const statusFile = path.join(dir, 'status.json');
    const startupInputFile = path.join(dir, 'startup-input.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    const envelope = JSON.stringify({
      version: 1,
      local_ui_password: 'password-secret',
      bootstrap_ticket: 'ticket-secret',
    });
    try {
      const launch = await startManagedRuntime({
        executablePath,
        runtimeArgs: ['--startup-secrets-stdin'],
        env: {
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_STARTUP_INPUT_FILE: startupInputFile,
          REDEVEN_LOCAL_UI_PASSWORD: 'inherited-password',
          REDEVEN_BOOTSTRAP_TICKET: 'inherited-ticket',
          REDEVEN_DESKTOP_BOOTSTRAP_TICKET: 'legacy-ticket',
        },
        startupSecretsStdin: envelope,
        tempRoot: dir,
        runtimeAttachTimeoutMs: 5_000,
        runtimeStabilityWindowMs: 20,
        runtimeStabilityPollMs: 10,
      });
      expect(launch.kind).toBe('ready');
      const deadline = Date.now() + 2_000;
      let captured: { stdin: string; secret_env: Record<string, string> } | null = null;
      while (Date.now() < deadline && captured === null) {
        try {
          captured = JSON.parse(await fs.readFile(startupInputFile, 'utf8')) as typeof captured;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      expect(captured).toEqual({
        stdin: envelope,
        secret_env: {
          local_ui_password: '',
          bootstrap_ticket: '',
          legacy_desktop_ticket: '',
        },
      });
      if (launch.kind === 'ready') {
        await launch.managedRuntime.stop();
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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

  it('cancels a spawned local runtime and verifies empty inventory before settling', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-process-'));
    const stateRoot = path.join(dir, 'state');
    const inventoryFile = path.join(dir, 'inventory.json');
    const statusFile = path.join(dir, 'status.json');
    const executablePath = await writeFakeRuntimeExecutable(dir);
    const controller = new AbortController();
    let launch: ReturnType<typeof startManagedRuntime> | null = null;
    try {
      let resolveStartingRuntime!: () => void;
      const startingRuntime = new Promise<void>((resolve) => {
        resolveStartingRuntime = resolve;
      });
      launch = startManagedRuntime({
        executablePath,
        runtimeArgs: ['--state-root', stateRoot],
        stateRoot,
        desktopOwnerID: 'desktop-owner-1',
        env: {
          REDEVEN_DESKTOP_OWNER_ID: 'desktop-owner-1',
          REDEVEN_TEST_RUNTIME_MODE: 'delayed_report',
          REDEVEN_TEST_STATUS_FILE: statusFile,
          REDEVEN_TEST_PROCESS_INVENTORY_FILE: inventoryFile,
        },
        tempRoot: dir,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'starting_runtime') {
            resolveStartingRuntime();
          }
        },
      });
      const unexpectedLaunchSettlement = launch.then(
        () => { throw new Error('Runtime launch settled before the cancellation fixture aborted it.'); },
        (error: unknown) => { throw error; },
      );
      await Promise.race([
        startingRuntime,
        unexpectedLaunchSettlement,
      ]);
      await Promise.race([
        waitForFile(inventoryFile),
        unexpectedLaunchSettlement,
      ]);
      const inventory = JSON.parse(await fs.readFile(inventoryFile, 'utf8')) as { instances?: Array<{ pid?: number }> };
      const pid = Number(inventory.instances?.[0]?.pid ?? 0);
      expect(pid).toBeGreaterThan(0);

      controller.abort(new DOMException('User canceled startup.', 'AbortError'));

      await expect(launch).rejects.toMatchObject({ name: 'AbortError' });
      await expect(fs.stat(inventoryFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statusFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.readdir(dir)).filter((entry) => entry.startsWith('redeven-desktop-'))).toEqual([]);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort(new DOMException('Test cleanup.', 'AbortError'));
      const settledLaunch = await launch?.catch(() => null);
      if (settledLaunch?.kind === 'ready') {
        await settledLaunch.managedRuntime.stop();
      }
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
