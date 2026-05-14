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
  DesktopSSHRuntimeCanceledError,
  startManagedSSHRuntime,
  type ManagedSSHRuntime,
  type ManagedSSHRuntimeAIBroker,
} from './sshRuntime';
import type { DesktopSSHBootstrapStrategy, DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';

type FakeSSHScenario =
  | 'ready'
  | 'attached_unsupported_idle'
  | 'attached_unsupported_active'
  | 'forwarded_blocked_readiness'
  | 'forwarded_invalid_env_shell'
  | 'binding_error'
  | 'reverse_forward_error'
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

function futureExpiryUnixMS() {
  return Date.now() + 24 * 60 * 60 * 1000;
}

function currentRuntimeService() {
  const state = readState();
  return {
    runtime_version: 'v1.2.3',
    protocol_version: 'redeven-runtime-v1',
    service_owner: 'desktop',
    desktop_managed: true,
    effective_run_mode: 'desktop',
    remote_enabled: false,
    compatibility: 'compatible',
    open_readiness: { state: 'openable' },
    active_workload: {
      terminal_count: 0,
      session_count: 0,
      task_count: 0,
      port_forward_count: 0,
    },
    capabilities: {
      desktop_ai_broker: {
        supported: true,
        bind_method: 'runtime_control_v1',
      },
      provider_link: {
        supported: true,
        bind_method: 'runtime_control_v1',
      },
    },
    bindings: {
      desktop_ai_broker: state.broker_bound
        ? {
            state: 'bound',
            session_id: state.broker_session_id || 'broker-session',
            ssh_runtime_key: state.broker_ssh_runtime_key || 'ssh:devbox',
            expires_at_unix_ms: state.broker_expires_at_unix_ms || futureExpiryUnixMS(),
            model_source: 'desktop_local_environment',
            model_count: 1,
        }
        : { state: 'unbound' },
      provider_link: { state: 'unbound' },
    },
  };
}

function oldUnsupportedRuntimeService(active) {
  return {
    runtime_version: 'v0.5.9',
    protocol_version: 'redeven-runtime-v1',
    service_owner: 'desktop',
    desktop_managed: true,
    effective_run_mode: 'desktop',
    remote_enabled: false,
    compatibility: 'compatible',
    open_readiness: {
      state: 'blocked',
      reason_code: 'runtime_open_readiness_unavailable',
      message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
    },
    active_workload: {
      terminal_count: active ? 1 : 0,
      session_count: active ? 1 : 0,
      task_count: 0,
      port_forward_count: active ? 1 : 0,
    },
  };
}

function runtimeServiceForScenario() {
  const state = readState();
  if (scenario === 'attached_unsupported_idle' && !state.stopped) {
    return oldUnsupportedRuntimeService(false);
  }
  if (scenario === 'attached_unsupported_active' && !state.stopped) {
    return oldUnsupportedRuntimeService(true);
  }
  return currentRuntimeService();
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
  const isRuntimeControlForward = remotePort === 39002;
  const server = http.createServer((request, response) => {
    if (isRuntimeControlForward && request.url === '/v1/runtime-control/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        data: {
          protocol_version: 'redeven-runtime-control-v1',
        },
      }));
      return;
    }
    if (request.url === '/api/local/runtime/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        data: {
          status: 'online',
          password_required: false,
          runtime_service: scenario === 'forwarded_blocked_readiness'
            ? {
                ...currentRuntimeService(),
                open_readiness: {
                  state: 'blocked',
                  reason_code: 'runtime_open_readiness_unavailable',
                  message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
                },
                active_workload: {
                  terminal_count: 1,
                  session_count: 1,
                  task_count: 0,
                  port_forward_count: 1,
                },
              }
            : scenario === 'forwarded_invalid_env_shell'
            ? {
                ...runtimeServiceForScenario(),
                open_readiness: {
                  state: 'blocked',
                  reason_code: 'env_app_shell_unavailable',
                  message: 'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
                },
              }
            : runtimeServiceForScenario(),
        },
      }));
      return;
    }
    if (request.url === '/_redeven_proxy/api/runtime/bindings/desktop-ai-broker' && request.method === 'POST') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (scenario === 'binding_error') {
          appendLog('bind_desktop_ai_broker_failed', {
            session_id: String(body.session_id || ''),
            ssh_runtime_key: String(body.ssh_runtime_key || ''),
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            ok: true,
            data: {
              ai_runtime: {
                desktop_broker: {
                  binding_state: 'error',
                  connected: true,
                  available: false,
                  last_error: 'simulated binding failure',
                },
              },
            },
          }));
          return;
        }
        const state = readState();
        writeState({
          ...state,
          broker_bound: true,
          broker_session_id: String(body.session_id || ''),
          broker_ssh_runtime_key: String(body.ssh_runtime_key || ''),
          broker_expires_at_unix_ms: Number(body.expires_at_unix_ms || 0),
        });
        appendLog('bind_desktop_ai_broker', {
          url: String(body.url || ''),
          has_token: Boolean(body.token),
          session_id: String(body.session_id || ''),
          ssh_runtime_key: String(body.ssh_runtime_key || ''),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          ok: true,
          data: {
            ai_runtime: {
              desktop_broker: {
                binding_state: 'bound',
                connected: true,
                available: true,
                model_count: 1,
              },
            },
          },
        }));
      });
      return;
    }
    if (request.url === '/_redeven_proxy/env/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(scenario === 'forwarded_invalid_env_shell'
        ? '<pre><a href="favicon.svg">favicon.svg</a><a href="logo.png">logo.png</a></pre>'
        : '<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>');
      return;
    }
    if (request.url === '/_redeven_proxy/env/assets/index.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(request.method === 'HEAD' ? undefined : 'console.log("env");');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  server.listen(localPort, '127.0.0.1', () => {
    appendLog(isRuntimeControlForward ? 'runtime_control_forward_start' : 'forward_start', { local_port: localPort, remote_port: remotePort });
  });
  terminateLater(isRuntimeControlForward ? 'runtime_control_forward_terminated' : 'forward_terminated', () => server.close());
}

function startReverseForward() {
  const spec = args[args.indexOf('-R') + 1] || '';
  appendLog('reverse_forward_start', { spec });
  if (scenario === 'reverse_forward_error') {
    process.stderr.write('remote port forwarding failed\n');
    process.exit(255);
  }
  process.stderr.write('Allocated port 41234 for remote forward to 127.0.0.1\n');
  terminateLater('reverse_forward_terminated');
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
} else if (args.includes('-R')) {
  startReverseForward();
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
      appendLog('start_runtime', { session_token: remoteScriptArgs()[2] || args[args.length - 1] || '' });
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
      const state = readState();
      const attachedUnsupported = (
        (scenario === 'attached_unsupported_idle' || scenario === 'attached_unsupported_active')
        && !state.stopped
      );
      process.stdout.write(JSON.stringify({
        ...(attachedUnsupported ? { status: 'attached' } : {}),
        local_ui_url: 'http://127.0.0.1:39001/',
        local_ui_urls: ['http://127.0.0.1:39001/'],
        runtime_control: {
          protocol_version: 'redeven-runtime-control-v1',
          base_url: 'http://127.0.0.1:39002/',
          token: 'runtime-control-token',
          desktop_owner_id: 'desktop-owner-test',
          expires_at_unix_ms: Date.now() + 60 * 60 * 1000,
        },
        password_required: true,
        effective_run_mode: 'local',
        desktop_managed: true,
        pid: 4242,
        runtime_service: runtimeServiceForScenario(),
      }));
      process.exit(0);
      break;
    case 'redeven-ssh-stop':
      appendLog('stop_runtime', { pid: remoteScriptArgs()[0] || args[args.length - 1] || '' });
      writeState({ ...readState(), stopped: true });
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

function futureExpiryUnixMS(): number {
  return Date.now() + 24 * 60 * 60 * 1000;
}

async function createFakeSSHFixture(scenario: FakeSSHScenario): Promise<FakeSSHFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-fake-ssh-'));
  const sshBinary = path.join(root, 'fake-ssh.js');
  const logPath = path.join(root, 'ssh-events.jsonl');
  const statePath = path.join(root, 'ssh-state.json');
  await fs.writeFile(sshBinary, FAKE_SSH_SCRIPT, { mode: 0o755 });
  await fs.writeFile(statePath, JSON.stringify({
    installed: scenario === 'ready'
      || scenario === 'attached_unsupported_idle'
      || scenario === 'attached_unsupported_active'
      || scenario === 'forwarded_blocked_readiness'
      || scenario === 'forwarded_invalid_env_shell'
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

async function waitForFakeSSHEvent(fixture: FakeSSHFixture, eventName: string, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await readFakeSSHEvents(fixture);
    if (events.some((event) => event.event === eventName)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for fake SSH event: ${eventName}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
    sourceRuntimeRoot?: string;
    forceRuntimeUpdate?: boolean;
    aiBroker?: ManagedSSHRuntimeAIBroker | null;
    signal?: AbortSignal;
  }> = {},
): Promise<ManagedSSHRuntime> {
  return withFakeSSHEnv(fixture, () => startManagedSSHRuntime({
    target: options.target ?? targetFor(strategy),
    runtimeReleaseTag: 'v1.2.3',
    desktopOwnerID: 'desktop-owner-test',
    sshBinary: fixture.sshBinary,
    sourceRuntimeRoot: options.sourceRuntimeRoot,
    forceRuntimeUpdate: options.forceRuntimeUpdate,
    tempRoot: fixture.root,
    assetCacheRoot: path.join(fixture.root, 'asset-cache'),
    startupTimeoutMs: options.startupTimeoutMs ?? 2_500,
    probeTimeoutMs: options.probeTimeoutMs ?? 2_500,
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
    aiBroker: options.aiBroker ?? null,
    signal: options.signal,
  }));
}

async function createFakeSourceRuntimeRoot(root: string): Promise<Readonly<{
  sourceRoot: string;
  binDir: string;
}>> {
  const sourceRoot = path.join(root, 'source-runtime');
  const binDir = path.join(root, 'fake-bin');
  await fs.mkdir(path.join(sourceRoot, 'cmd', 'redeven'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'scripts'), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'scripts', 'build_assets.sh'), `#!/bin/sh
set -eu
printf 'ready\\n' > .assets-built
`, { mode: 0o755 });
  const fakeGo = path.join(binDir, 'go');
  await fs.writeFile(fakeGo, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
if (args[0] !== 'build' || outputIndex < 0 || !args[outputIndex + 1]) {
  process.exit(2);
}
if (!fs.existsSync('.assets-built')) {
  process.exit(3);
}
fs.writeFileSync(args[outputIndex + 1], '#!/bin/sh\\necho fake redeven\\n');
`, { mode: 0o755 });
  return { sourceRoot, binDir };
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
        lifecycle_owner: 'external',
        launch_mode: 'spawned',
      }));

      const response = await fetch(new URL('/api/local/runtime/health', runtime.local_forward_url));
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        data: {
          status: 'online',
          password_required: false,
          runtime_service: {
            open_readiness: {
              state: 'openable',
            },
          },
        },
      });
    } finally {
      await runtime?.disconnect();
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
    expect(events.map((event) => event.event)).not.toContain('stop_runtime');
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

  it('binds the Desktop AI Broker after the forwarded runtime opens', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
      });
      expect(runtime.startup.runtime_service).toMatchObject({
        capabilities: {
          desktop_ai_broker: {
            supported: true,
            bind_method: 'runtime_control_v1',
          },
        },
        bindings: {
          desktop_ai_broker: {
            state: 'bound',
            session_id: 'broker-session',
            ssh_runtime_key: 'ssh:devbox',
          },
        },
      });
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'reverse_forward_start',
      'bind_desktop_ai_broker',
    ]));
    const bindEvent = events.find((event) => event.event === 'bind_desktop_ai_broker');
    expect(bindEvent?.data).toEqual(expect.objectContaining({
      session_id: 'broker-session',
      ssh_runtime_key: 'ssh:devbox',
      has_token: true,
    }));
    expect(events.map((event) => event.event)).not.toContain('stop_runtime');
    await removeFakeSSHFixture(fixture);
  });

  it('keeps opening the SSH runtime when Desktop AI Broker binding fails', async () => {
    const fixture = await createFakeSSHFixture('binding_error');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
      });
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.startup.runtime_service?.bindings?.desktop_ai_broker?.state).toBe('unbound');
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'reverse_forward_start',
      'start_runtime',
      'bind_desktop_ai_broker_failed',
    ]));
    await removeFakeSSHFixture(fixture);
  });

  it('keeps opening the SSH runtime when the Desktop model reverse bridge fails', async () => {
    const fixture = await createFakeSSHFixture('reverse_forward_error');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
      });
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.startup.runtime_service?.bindings?.desktop_ai_broker?.state).toBe('unbound');
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'reverse_forward_start',
      'start_runtime',
    ]));
    expect(events.map((event) => event.event)).not.toContain('bind_desktop_ai_broker');
    await removeFakeSSHFixture(fixture);
  });

  it('stops the remote runtime only when the user explicitly stops the SSH runtime', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      await withFakeSSHEnv(fixture, () => runtime!.stop());
      runtime = null;
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'stop_runtime',
      'forward_terminated',
      'control_terminated',
      'master_terminated',
    ]));
    expect(events.find((event) => event.event === 'stop_runtime')?.data).toEqual({
      pid: '4242',
    });
    await removeFakeSSHFixture(fixture);
  });

  it('aborts a pending SSH startup and tears down long-lived SSH processes before opening a tunnel', async () => {
    const fixture = await createFakeSSHFixture('no_report');
    try {
      const abortController = new AbortController();
      const startup = startWithFakeSSH(fixture, 'auto', {
        startupTimeoutMs: 2_500,
        signal: abortController.signal,
      });

      await waitForFakeSSHEvent(fixture, 'start_runtime');
      abortController.abort();

      await expect(startup).rejects.toBeInstanceOf(DesktopSSHRuntimeCanceledError);
      await waitForFakeSSHEvent(fixture, 'master_terminated');
      await waitForFakeSSHEvent(fixture, 'control_terminated');

      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
        'master_start',
        'start_runtime',
        'master_terminated',
        'control_terminated',
      ]));
      expect(events.map((event) => event.event)).not.toContain('forward_start');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('keeps the SSH tunnel attached when the forwarded Local UI reports blocked open-readiness', async () => {
    const fixture = await createFakeSSHFixture('forwarded_blocked_readiness');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.runtime_handle.launch_mode).toBe('spawned');
      expect(runtime.startup.runtime_service).toMatchObject({
        runtime_version: 'v1.2.3',
        open_readiness: {
          state: 'blocked',
          reason_code: 'runtime_open_readiness_unavailable',
        },
        active_workload: {
          terminal_count: 1,
          session_count: 1,
          port_forward_count: 1,
        },
      });
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'master_start',
      'start_runtime',
      'read_report',
      'forward_start',
      'forward_terminated',
      'control_terminated',
      'master_terminated',
    ]));
    expect(eventNames).not.toContain('stop_runtime');
    await removeFakeSSHFixture(fixture);
  });

  it('replaces an idle attached runtime that does not yet support Desktop AI Broker binding', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_idle');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
      });
      expect(runtime.runtime_handle.launch_mode).toBe('spawned');
      expect(runtime.startup.runtime_service).toMatchObject({
        runtime_version: 'v1.2.3',
        bindings: {
          desktop_ai_broker: {
            state: 'bound',
          },
        },
      });
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
      'start_runtime',
      'stop_runtime',
      'bind_desktop_ai_broker',
    ]));
    await removeFakeSSHFixture(fixture);
  });

  it('blocks an attached runtime that needs Desktop AI Broker binding but still has active work', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_active');
    await expect(startWithFakeSSH(fixture, 'auto', {
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
    })).rejects.toThrow('needs to update before Desktop can prepare the Desktop model source');

    const events = await readFakeSSHEvents(fixture);
    expect(events.map((event) => event.event)).toContain('start_runtime');
    expect(events.map((event) => event.event)).not.toContain('stop_runtime');
    await removeFakeSSHFixture(fixture);
  });

  it('keeps the SSH tunnel attached but blocks Open when the forwarded Env App shell is invalid', async () => {
    const fixture = await createFakeSSHFixture('forwarded_invalid_env_shell');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.runtime_handle.launch_mode).toBe('spawned');
      expect(runtime.startup.runtime_service).toMatchObject({
        runtime_version: 'v1.2.3',
        open_readiness: {
          state: 'blocked',
          reason_code: 'env_app_shell_unavailable',
        },
      });
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'master_start',
      'start_runtime',
      'read_report',
      'forward_start',
      'forward_terminated',
      'control_terminated',
      'master_terminated',
    ]));
    expect(eventNames).not.toContain('stop_runtime');
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
      'read_report',
    ]));
    expect(eventNames).not.toContain('forward_start');
    expect(eventNames).not.toContain('stop_runtime');
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

  it('reinstalls a release runtime when the user explicitly requests an update before restart', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'remote_install', {
        forceRuntimeUpdate: true,
      });
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
    expect(eventNames.filter((event) => event === 'remote_install')).toHaveLength(1);
    await removeFakeSSHFixture(fixture);
  });

  it('replaces an active unsupported runtime after the user explicitly confirms an update', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_active');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        forceRuntimeUpdate: true,
        aiBroker: {
          local_url: 'http://127.0.0.1:41234',
          token: 'broker-token',
          session_id: 'broker-session',
          ssh_runtime_key: 'ssh:devbox',
          expires_at_unix_ms: futureExpiryUnixMS(),
        },
      });
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'start_runtime',
      'stop_runtime',
      'forward_start',
    ]));
    expect(eventNames.filter((event) => event === 'start_runtime')).toHaveLength(2);
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

  it('builds and uploads the current checkout runtime for source-dev SSH bootstrap', async () => {
    const fixture = await createFakeSSHFixture('desktop_upload');
    const source = await createFakeSourceRuntimeRoot(fixture.root);
    const previousPath = process.env.PATH;
    process.env.PATH = `${source.binDir}${path.delimiter}${previousPath ?? ''}`;

    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'desktop_upload', {
        sourceRuntimeRoot: source.sourceRoot,
      });
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    expect(sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'upload_archive',
        data: expect.objectContaining({
          bytes: expect.any(Number),
        }),
      }),
      expect.objectContaining({ event: 'upload_install' }),
      expect.objectContaining({ event: 'start_runtime' }),
    ]));
    expect(Number(events.find((event) => event.event === 'upload_archive')?.data?.bytes ?? 0)).toBeGreaterThan(0);
    await removeFakeSSHFixture(fixture);
  });

  it('rebuilds and uploads source-dev runtime even when the remote tag already looks installed', async () => {
    const fixture = await createFakeSSHFixture('ready');
    const source = await createFakeSourceRuntimeRoot(fixture.root);
    const previousPath = process.env.PATH;
    process.env.PATH = `${source.binDir}${path.delimiter}${previousPath ?? ''}`;

    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        sourceRuntimeRoot: source.sourceRoot,
      });
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'probe_runtime',
      'probe_platform',
      'upload_archive',
      'upload_install',
      'start_runtime',
    ]));
    expect(sshReleaseAssetMocks.ensureDesktopSSHReleaseAsset).not.toHaveBeenCalled();
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
