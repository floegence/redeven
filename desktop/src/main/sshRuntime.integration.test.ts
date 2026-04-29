import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const sshReleaseAssetMocks = vi.hoisted(() => ({
  ensureDesktopSSHReleaseAsset: vi.fn(),
}));

vi.mock('./sshReleaseAssets', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('./sshReleaseAssets');
  return {
    ...actual,
    ensureDesktopSSHReleaseAsset: sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset,
  };
});

import {
  startManagedSSHRuntime,
  type ManagedSSHRuntime,
} from './sshRuntime';
import type { DesktopSSHBootstrapStrategy, DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';

type FakeSSHScenario = 'ready' | 'remote_install' | 'desktop_upload' | 'no_report';

type FakeSSHEvent = Readonly<{
  event: string;
  args: readonly string[];
  data?: Readonly<Record<string, unknown>>;
}>;

type FakeSSHFixture = Readonly<{
  root: string;
  sshBinary: string;
  logPath: string;
  statePath: string;
  scenario: FakeSSHScenario;
}>;

const FAKE_SSH_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(2);
const logPath = process.env.REDEVEN_FAKE_SSH_LOG;
const statePath = process.env.REDEVEN_FAKE_SSH_STATE;
const scenario = process.env.REDEVEN_FAKE_SSH_SCENARIO || 'ready';

function appendLog(event, data) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ event, args, data: data || {} }) + '\n');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { installed: scenario === 'ready' || scenario === 'no_report' };
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(next));
}

function controlSocketPath() {
  const index = args.indexOf('-S');
  return index >= 0 ? args[index + 1] || '' : '';
}

function marker() {
  const markers = [
    'redeven-ssh-runtime-probe',
    'redeven-ssh-remote-install',
    'redeven-ssh-upload-archive',
    'redeven-ssh-upload-install',
    'redeven-ssh-cleanup-path',
    'redeven-ssh-start',
    'redeven-ssh-read-report',
  ];
  return markers.find((value) => args.includes(value)) || '';
}

function terminateLater(event, cleanup) {
  const finish = () => {
    appendLog(event);
    setTimeout(() => {
      if (cleanup) cleanup();
      process.exit(0);
    }, 10);
  };
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);
  setInterval(() => {}, 1000);
}

function writeProbeResult() {
  const state = readState();
  const installed = state.installed === true;
  const status = installed ? 'ready' : 'missing_binary';
  const reason = installed ? 'desktop-managed runtime is compatible' : 'managed runtime binary is missing';
  const releaseTag = args[args.length - 1] || 'v0.0.0';
  process.stdout.write([
    'status=' + status,
    'expected_release_tag=' + releaseTag,
    'reported_release_tag=' + (installed ? releaseTag : ''),
    'binary_path=/remote/redeven/releases/' + releaseTag + '/bin/redeven',
    'stamp_path=/remote/redeven/releases/' + releaseTag + '/desktop-runtime.stamp',
    'reason=' + reason,
    '',
  ].join('\n'));
}

function readStdin(callback) {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  process.stdin.on('end', () => callback(Buffer.concat(chunks)));
}

function startForward() {
  const spec = args[args.indexOf('-L') + 1] || '';
  const parts = spec.split(':');
  const localPort = Number(parts[1]);
  const remotePort = Number(parts[3]);
  const server = http.createServer((request, response) => {
    if (request.url === '/api/local/runtime/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        data: {
          status: 'online',
          password_required: false,
        },
      }));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  server.listen(localPort, '127.0.0.1', () => {
    appendLog('forward_start', { local_port: localPort, remote_port: remotePort });
  });
  terminateLater('forward_terminated', () => server.close());
}

if (args.includes('-O') && args.includes('check')) {
  appendLog('master_check', { socket: controlSocketPath() });
  process.exit(0);
}

if (args.includes('-M') && args.includes('-N')) {
  appendLog('master_start', { socket: controlSocketPath() });
  terminateLater('master_terminated');
} else if (args.includes('-L')) {
  startForward();
} else {
  switch (marker()) {
    case 'redeven-ssh-runtime-probe':
      appendLog('probe_runtime');
      writeProbeResult();
      process.exit(0);
      break;
    case 'redeven-ssh-remote-install':
      appendLog('remote_install', { install_script_url: args[args.length - 1] || '' });
      writeState({ installed: true });
      process.exit(0);
      break;
    case 'redeven-ssh-upload-archive':
      readStdin((data) => {
        appendLog('upload_archive', { bytes: data.length });
        process.exit(0);
      });
      break;
    case 'redeven-ssh-upload-install':
      appendLog('upload_install');
      writeState({ installed: true });
      process.exit(0);
      break;
    case 'redeven-ssh-cleanup-path':
      appendLog('cleanup_remote_path', { remote_path: args[args.length - 1] || '' });
      process.exit(0);
      break;
    case 'redeven-ssh-start':
      appendLog('start_runtime', { instance_id: args[args.length - 2] || '' });
      terminateLater('control_terminated');
      break;
    case 'redeven-ssh-read-report':
      appendLog('read_report');
      if (scenario === 'no_report') {
        process.exit(1);
      }
      process.stdout.write(JSON.stringify({
        local_ui_url: 'http://127.0.0.1:39001/',
        local_ui_urls: ['http://127.0.0.1:39001/'],
        password_required: true,
        effective_run_mode: 'local',
        desktop_managed: true,
        pid: 4242,
      }));
      process.exit(0);
      break;
    default:
      if (args.some((value) => String(value).includes('mktemp -d'))) {
        appendLog('create_remote_temp_dir');
        process.stdout.write('/tmp/redeven-ssh-upload.fake\n');
        process.exit(0);
      }
      if (args.some((value) => String(value).includes('uname -s'))) {
        appendLog('probe_platform');
        process.stdout.write('Linux\nx86_64\n');
        process.exit(0);
      }
      appendLog('unknown_command');
      process.exit(1);
  }
}
`;

async function createFakeSSHFixture(scenario: FakeSSHScenario): Promise<FakeSSHFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-fake-ssh-'));
  const sshBinary = path.join(root, 'fake-ssh.js');
  const logPath = path.join(root, 'ssh-events.jsonl');
  const statePath = path.join(root, 'ssh-state.json');
  await fs.writeFile(sshBinary, FAKE_SSH_SCRIPT, { mode: 0o755 });
  await fs.writeFile(statePath, JSON.stringify({
    installed: scenario === 'ready' || scenario === 'no_report',
  }));
  return {
    root,
    sshBinary,
    logPath,
    statePath,
    scenario,
  };
}

async function readFakeSSHEvents(fixture: FakeSSHFixture): Promise<readonly FakeSSHEvent[]> {
  const raw = await fs.readFile(fixture.logPath, 'utf8').catch(() => '');
  return raw
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeSSHEvent);
}

async function withFakeSSHEnv<T>(fixture: FakeSSHFixture, run: () => Promise<T>): Promise<T> {
  const previousLog = process.env.REDEVEN_FAKE_SSH_LOG;
  const previousState = process.env.REDEVEN_FAKE_SSH_STATE;
  const previousScenario = process.env.REDEVEN_FAKE_SSH_SCENARIO;
  process.env.REDEVEN_FAKE_SSH_LOG = fixture.logPath;
  process.env.REDEVEN_FAKE_SSH_STATE = fixture.statePath;
  process.env.REDEVEN_FAKE_SSH_SCENARIO = fixture.scenario;
  try {
    return await run();
  } finally {
    if (previousLog === undefined) {
      delete process.env.REDEVEN_FAKE_SSH_LOG;
    } else {
      process.env.REDEVEN_FAKE_SSH_LOG = previousLog;
    }
    if (previousState === undefined) {
      delete process.env.REDEVEN_FAKE_SSH_STATE;
    } else {
      process.env.REDEVEN_FAKE_SSH_STATE = previousState;
    }
    if (previousScenario === undefined) {
      delete process.env.REDEVEN_FAKE_SSH_SCENARIO;
    } else {
      process.env.REDEVEN_FAKE_SSH_SCENARIO = previousScenario;
    }
  }
}

function targetFor(strategy: DesktopSSHBootstrapStrategy): DesktopSSHEnvironmentDetails {
  return {
    ssh_destination: 'devbox',
    ssh_port: 2222,
    remote_install_dir: 'remote_default',
    bootstrap_strategy: strategy,
    release_base_url: '',
    environment_instance_id: 'envinst_demo001',
  };
}

async function startWithFakeSSH(
  fixture: FakeSSHFixture,
  strategy: DesktopSSHBootstrapStrategy,
  options: Readonly<{
    startupTimeoutMs?: number;
    probeTimeoutMs?: number;
  }> = {},
): Promise<ManagedSSHRuntime> {
  return withFakeSSHEnv(fixture, () => startManagedSSHRuntime({
    target: targetFor(strategy),
    runtimeReleaseTag: 'v1.2.3',
    sshBinary: fixture.sshBinary,
    tempRoot: fixture.root,
    assetCacheRoot: path.join(fixture.root, 'asset-cache'),
    startupTimeoutMs: options.startupTimeoutMs ?? 2_500,
    probeTimeoutMs: options.probeTimeoutMs ?? 2_500,
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
  }));
}

async function removeFakeSSHFixture(fixture: FakeSSHFixture): Promise<void> {
  await fs.rm(fixture.root, { recursive: true, force: true });
}

afterEach(() => {
  sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset.mockReset();
});

describe('sshRuntime integration', () => {
  it('starts an already-installed remote runtime through a fake SSH control socket and local forward', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.local_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.startup.local_ui_urls).toEqual([runtime.local_forward_url]);
      expect(runtime.startup.password_required).toBe(false);
      expect(runtime.runtime_handle).toEqual(expect.objectContaining({
        runtime_kind: 'ssh',
        lifecycle_owner: 'desktop',
        launch_mode: 'spawned',
      }));

      const response = await fetch(new URL('/api/local/runtime/health', runtime.local_forward_url));
      await expect(response.json()).resolves.toEqual({
        success: true,
        data: {
          status: 'online',
          password_required: false,
        },
      });
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'master_start',
      'master_check',
      'probe_runtime',
      'start_runtime',
      'read_report',
      'forward_start',
      'forward_terminated',
      'control_terminated',
      'master_terminated',
    ]));
    expect(events.some((event) => event.event === 'remote_install' || event.event === 'upload_install')).toBe(false);
    await removeFakeSSHFixture(fixture);
  });

  it('runs the remote installer when the probe reports a missing runtime', async () => {
    const fixture = await createFakeSSHFixture('remote_install');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'remote_install');
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'probe_runtime',
      'remote_install',
      'start_runtime',
      'forward_start',
    ]));
    expect(eventNames.filter((event) => event === 'probe_runtime')).toHaveLength(2);
    expect(String(events.find((event) => event.event === 'remote_install')?.data?.install_script_url ?? '')).toMatch(/\/install\.sh$/u);
    await removeFakeSSHFixture(fixture);
  });

  it('uploads a locally prepared release archive for desktop-upload bootstrap', async () => {
    const fixture = await createFakeSSHFixture('desktop_upload');
    const archivePath = path.join(fixture.root, 'fake-redeven.tar.gz');
    await fs.writeFile(archivePath, Buffer.from('fake archive'));
    sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset.mockResolvedValue({
      release_tag: 'v1.2.3',
      release_base_url: '',
      source_cache_key: 'test-source',
      platform: {
        goos: 'linux',
        goarch: 'amd64',
        platform_id: 'linux_amd64',
        release_package_name: 'redeven_linux_amd64.tar.gz',
        platform_label: 'linux/amd64',
      },
      archive_path: archivePath,
      sha256: '0'.repeat(64),
    });

    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'desktop_upload');
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({
      releaseTag: 'v1.2.3',
      releaseBaseURL: '',
      platform: expect.objectContaining({
        platform_id: 'linux_amd64',
        release_package_name: 'redeven_linux_amd64.tar.gz',
      }),
    }));
    expect(eventNames).toEqual(expect.arrayContaining([
      'probe_platform',
      'upload_archive',
      'upload_install',
      'cleanup_remote_path',
      'start_runtime',
      'forward_start',
    ]));
    expect(events.find((event) => event.event === 'upload_archive')?.data?.bytes).toBe(Buffer.byteLength('fake archive'));
    await removeFakeSSHFixture(fixture);
  });

  it('cleans up long-lived SSH processes and the control socket directory when startup report polling times out', async () => {
    const fixture = await createFakeSSHFixture('no_report');
    await expect(startWithFakeSSH(fixture, 'auto', {
      startupTimeoutMs: 350,
      probeTimeoutMs: 350,
    })).rejects.toThrow('Timed out waiting for remote Redeven to report readiness over SSH.');

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'master_start',
      'start_runtime',
      'read_report',
      'control_terminated',
      'master_terminated',
    ]));
    expect(eventNames).not.toContain('forward_start');

    const masterStart = events.find((event) => event.event === 'master_start');
    const socketPath = String(masterStart?.data?.socket ?? '');
    expect(socketPath).not.toBe('');
    await expect(fs.access(path.dirname(socketPath))).rejects.toThrow();
    await removeFakeSSHFixture(fixture);
  });
});
