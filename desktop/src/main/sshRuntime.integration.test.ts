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

type FakeSSHScenario =
  | 'ready'
  | 'remote_install'
  | 'desktop_upload'
  | 'no_report'
  | 'quick_exit_report'
  | 'blocked_report';

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

function sshOptionValue(name) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] !== '-o') continue;
    const option = String(args[index + 1] || '');
    if (option === name || option.startsWith(name + '=')) {
      return option.includes('=') ? option.slice(option.indexOf('=') + 1) : '';
    }
  }
  return '';
}

function splitShellWords(command) {
  const words = [];
  let current = '';
  let quote = '';
  let hasWord = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") {
        quote = '';
      } else {
        current += char;
        hasWord = true;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = '';
      } else if (char === '\\') {
        index += 1;
        current += command[index] || '';
        hasWord = true;
      } else {
        current += char;
        hasWord = true;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (hasWord) {
        words.push(current);
        current = '';
        hasWord = false;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
      continue;
    }
    if (char === '\\') {
      index += 1;
      current += command[index] || '';
      hasWord = true;
      continue;
    }
    current += char;
    hasWord = true;
  }
  if (hasWord) {
    words.push(current);
  }
  return words;
}

function remoteCommandWords() {
  const command = args.find((value) => String(value).startsWith('sh -c ') || String(value).startsWith('sh -lc '));
  if (!command) {
    return args;
  }
  return splitShellWords(String(command));
}

function marker() {
  const markers = [
    'redeven-ssh-runtime-probe',
    'redeven-ssh-probe-platform',
    'redeven-ssh-create-upload-dir',
    'redeven-ssh-remote-install',
    'redeven-ssh-upload-archive',
    'redeven-ssh-upload-install',
    'redeven-ssh-cleanup-path',
    'redeven-ssh-start',
    'redeven-ssh-read-report',
    'redeven-ssh-stop',
  ];
  const words = remoteCommandWords();
  return markers.find((value) => args.includes(value) || words.includes(value)) || '';
}

function remoteScriptArgs() {
  const words = remoteCommandWords();
  const commandMarker = marker();
  const index = words.indexOf(commandMarker);
  if (index < 0) {
    return [];
  }
  return words.slice(index + 1);
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
  const releaseTag = remoteScriptArgs()[1] || args[args.length - 1] || 'v0.0.0';
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
  appendLog('master_start', {
    socket: controlSocketPath(),
    batch_mode: sshOptionValue('BatchMode'),
    password_prompts: sshOptionValue('NumberOfPasswordPrompts'),
    forward_x11: sshOptionValue('ForwardX11'),
    request_tty: sshOptionValue('RequestTTY'),
    disables_x11: args.includes('-x'),
    disables_tty: args.includes('-T'),
    askpass_require: process.env.SSH_ASKPASS_REQUIRE || '',
    askpass_configured: Boolean(process.env.SSH_ASKPASS),
  });
  terminateLater('master_terminated');
} else if (args.includes('-L')) {
  startForward();
} else {
  switch (marker()) {
    case 'redeven-ssh-runtime-probe':
      appendLog('probe_runtime', {
        script_args: remoteScriptArgs(),
        open_ssh_remote_command: args.some((value) => String(value).startsWith('sh -c ') || String(value).startsWith('sh -lc ')),
      });
      writeProbeResult();
      process.exit(0);
      break;
    case 'redeven-ssh-probe-platform':
      appendLog('probe_platform');
      process.stdout.write('Linux\nx86_64\n');
      process.exit(0);
      break;
    case 'redeven-ssh-create-upload-dir':
      appendLog('create_remote_temp_dir');
      process.stdout.write('/tmp/redeven-ssh-upload.fake\n');
      process.exit(0);
      break;
    case 'redeven-ssh-remote-install':
      appendLog('remote_install', { install_script_url: remoteScriptArgs()[2] || args[args.length - 1] || '' });
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
      appendLog('cleanup_remote_path', { remote_path: remoteScriptArgs()[0] || args[args.length - 1] || '' });
      process.exit(0);
      break;
    case 'redeven-ssh-start':
      appendLog('start_runtime', { instance_id: remoteScriptArgs()[2] || args[args.length - 2] || '' });
      if (scenario === 'blocked_report') {
        process.exit(1);
      }
      if (scenario === 'quick_exit_report') {
        process.exit(0);
      }
      terminateLater('control_terminated');
      break;
    case 'redeven-ssh-read-report':
      appendLog('read_report');
      if (scenario === 'no_report') {
        process.exit(1);
      }
      if (scenario === 'blocked_report') {
        process.stdout.write(JSON.stringify({
          status: 'blocked',
          code: 'state_dir_locked',
          message: 'Another Redeven runtime instance is already using this state directory.',
          diagnostics: {
            lock_path: '/remote/redeven/state/agent.lock',
            state_dir: '/remote/redeven/state',
          },
        }));
        process.exit(0);
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
    case 'redeven-ssh-stop':
      appendLog('stop_runtime', { pid: remoteScriptArgs()[0] || args[args.length - 1] || '' });
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
    installed: scenario === 'ready'
      || scenario === 'no_report'
      || scenario === 'quick_exit_report'
      || scenario === 'blocked_report',
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
    auth_mode: 'key_agent',
    remote_install_dir: 'remote_default',
    bootstrap_strategy: strategy,
    release_base_url: '',
    environment_instance_id: 'envinst_demo001',
  };
}

function targetForPasswordAuth(strategy: DesktopSSHBootstrapStrategy): DesktopSSHEnvironmentDetails {
  return {
    ...targetFor(strategy),
    auth_mode: 'password',
  };
}

async function startWithFakeSSH(
  fixture: FakeSSHFixture,
  strategy: DesktopSSHBootstrapStrategy,
  options: Readonly<{
    startupTimeoutMs?: number;
    probeTimeoutMs?: number;
    target?: DesktopSSHEnvironmentDetails;
  }> = {},
): Promise<ManagedSSHRuntime> {
  return withFakeSSHEnv(fixture, () => startManagedSSHRuntime({
    target: options.target ?? targetFor(strategy),
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
      expect(runtime.startup.pid).toBe(4242);
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
    const runtimeProbe = events.find((event) => event.event === 'probe_runtime');
    expect(runtimeProbe?.data).toEqual(expect.objectContaining({
      script_args: ['remote_default', 'v1.2.3'],
      open_ssh_remote_command: true,
    }));
    const masterStart = events.find((event) => event.event === 'master_start');
    expect(masterStart?.data).toEqual(expect.objectContaining({
      forward_x11: 'no',
      request_tty: 'no',
      disables_x11: true,
      disables_tty: true,
    }));
    await removeFakeSSHFixture(fixture);
  });

  it('uses a readiness report even when the remote start command exits quickly', async () => {
    const fixture = await createFakeSSHFixture('quick_exit_report');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.local_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      expect(runtime.startup.local_ui_urls).toEqual([runtime.local_forward_url]);
      expect(runtime.runtime_handle.launch_mode).toBe('spawned');
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'start_runtime',
      'read_report',
      'forward_start',
    ]));
    expect(eventNames).not.toContain('remote_install');
    await removeFakeSSHFixture(fixture);
  });

  it('surfaces blocked remote desktop launch reports instead of a generic stopped-before-ready error', async () => {
    const fixture = await createFakeSSHFixture('blocked_report');
    await expect(startWithFakeSSH(fixture, 'auto')).rejects.toThrow(
      'Another Redeven runtime instance is already using this state directory.',
    );

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'start_runtime',
      'read_report',
    ]));
    expect(eventNames).not.toContain('forward_start');
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

  it('allows password authentication by disabling SSH batch mode and configuring askpass', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        target: targetForPasswordAuth('auto'),
      });
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const masterStart = events.find((event) => event.event === 'master_start');
    expect(masterStart?.data).toEqual(expect.objectContaining({
      batch_mode: 'no',
      password_prompts: '3',
      askpass_require: 'force',
      askpass_configured: true,
    }));
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
