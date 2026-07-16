import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sshReleaseTrust', () => ({
  verifyDesktopSSHReleaseManifestSignature: vi.fn(),
}));

import {
  DesktopSSHRuntimeCanceledError,
  ensureManagedSSHRuntimeReady,
  inspectManagedSSHRuntimeProcesses,
  openManagedSSHRuntimeConnection,
  probeManagedSSHRuntimeStatus,
  startManagedSSHRuntime,
  stopManagedSSHRuntimeProcesses,
  type ManagedSSHRuntime,
  type ManagedSSHRuntimeReady,
} from './sshRuntime';
import type { DesktopSSHBootstrapStrategy, DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';

type FakeSSHScenario =
  | 'ready'
  | 'missing_runtime_control_idle'
  | 'missing_runtime_control_active'
  | 'attached_unsupported_idle'
  | 'attached_unsupported_active'
  | 'persistent_version_mismatch'
  | 'forwarded_blocked_readiness'
  | 'forwarded_invalid_env_shell'
  | 'forwarded_delayed_health'
  | 'forwarded_health_timeout'
  | 'forwarded_network_reset'
  | 'forwarded_invalid_response'
  | 'runtime_control_forward_early_exit'
  | 'remote_install'
  | 'desktop_upload'
  | 'upload_install_fail'
  | 'no_report'
  | 'quick_exit_report'
  | 'blocked_report'
  | 'transient_blocked_report'
  | 'status_blocked_without_socket'
  | 'duplicate_current_owner'
  | 'foreign_owner';

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

const SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS = 30_000;

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function installReleaseFetchMock(archives: ReadonlyMap<string, Buffer>): ReturnType<typeof vi.fn> {
  const sumsText = [...archives.entries()]
    .map(([name, archive]) => `${sha256(archive)}  ${name}`)
    .join('\n');
  const realFetch = globalThis.fetch.bind(globalThis);
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes('/download/')) {
      return realFetch(input, init);
    }
    if (url.endsWith('/SHA256SUMS')) {
      return new Response(sumsText, { status: 200 });
    }
    if (url.endsWith('/SHA256SUMS.sig')) {
      return new Response('test-signature', { status: 200 });
    }
    if (url.endsWith('/SHA256SUMS.pem')) {
      return new Response('test-certificate', { status: 200 });
    }
    const archive = archives.get(path.basename(new URL(url).pathname));
    if (archive) {
      return new Response(new Uint8Array(archive), { status: 200 });
    }
    return new Response('missing', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function releaseArchiveFetchCount(fetchMock: ReturnType<typeof vi.fn>, packageName: string): number {
  return fetchMock.mock.calls.filter((call) => String(call[0]).endsWith(`/${packageName}`)).length;
}

const FAKE_SSH_SCRIPT = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = process.argv.slice(2);
const logPath = process.env.REDEVEN_FAKE_SSH_LOG;
const statePath = process.env.REDEVEN_FAKE_SSH_STATE;
const scenario = process.env.REDEVEN_FAKE_SSH_SCENARIO || 'ready';
const compatibilityEpoch = Number(process.env.REDEVEN_FAKE_SSH_COMPATIBILITY_EPOCH || 0);

function appendLog(event, data) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ event, args, data: data || {} }) + '\n');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {
      installed: scenario === 'ready' || scenario === 'no_report',
      installed_version: 'v1.2.3',
    };
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
  const runtimeVersion = scenario === 'persistent_version_mismatch'
    ? 'v1.2.2'
    : String(state.installed_version || 'v1.2.3');
  return {
    runtime_version: runtimeVersion,
    protocol_version: 'redeven-runtime-v1',
    compatibility_epoch: compatibilityEpoch,
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
      desktop_model_source: {
        supported: true,
        bind_method: 'runtime_control_v1',
      },
      provider_link: {
        supported: true,
        bind_method: 'runtime_control_v1',
      },
    },
    bindings: {
      desktop_model_source: state.model_source_bound
        ? {
            state: 'bound',
            session_id: state.model_source_session_id || 'desktop-session',
            expires_at_unix_ms: state.model_source_expires_at_unix_ms || futureExpiryUnixMS(),
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
  if (scenario === 'attached_unsupported_idle' && state.restarted !== true && state.stopped !== true) {
    return oldUnsupportedRuntimeService(false);
  }
  if (scenario === 'attached_unsupported_active' && state.restarted !== true && state.stopped !== true) {
    return oldUnsupportedRuntimeService(true);
  }
  if (scenario === 'missing_runtime_control_active' && state.restarted !== true && state.stopped !== true) {
    return {
      ...currentRuntimeService(),
      active_workload: {
        terminal_count: 1,
        session_count: 1,
        task_count: 0,
        port_forward_count: 1,
      },
    };
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
    'redeven-ssh-activate-runtime',
    'redeven-ssh-cleanup-path',
    'redeven-ssh-start',
    'redeven-ssh-read-report',
    'redeven-ssh-runtime-status',
    'redeven-ssh-runtime-helper-platform',
    'redeven-ssh-runtime-process-helper',
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

function remoteRuntimeStateRoot() {
  return remoteScriptArgs()[1] || remoteScriptArgs()[0] || 'remote_default';
}

function remoteStartSessionToken() {
  return remoteScriptArgs()[3] || args[args.length - 1] || '';
}

function remoteInstallReleaseTag() {
  return remoteScriptArgs()[1] || 'v1.2.3';
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
  const reason = installed ? 'desktop-managed runtime slot is ready' : 'managed runtime binary is missing';
  const releaseTag = remoteInstallReleaseTag() || args[args.length - 1] || 'v0.0.0';
  const installedVersion = String(state.installed_version || releaseTag);
  process.stdout.write([
    'status=' + status,
    'slot_release_tag=' + (installed ? installedVersion : ''),
    'reported_release_tag=' + (installed ? installedVersion : ''),
    'target_release_tag=' + releaseTag,
    'binary_path=/remote/redeven/runtime/managed/bin/redeven',
    'stamp_path=/remote/redeven/runtime/managed/managed-runtime.stamp',
    'reason=' + reason,
    '',
  ].join('\n'));
}

function writeRuntimeStatus() {
  const state = readState();
  if (scenario === 'status_blocked_without_socket') {
    process.stdout.write(JSON.stringify({
      status: 'blocked',
      code: 'live_process_without_management_socket',
      message: 'A Redeven runtime process is alive, but its management socket is not reachable.',
      lock_owner: {
        pid: 4242,
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner-test',
      },
      diagnostics: {
        lock_pid: 4242,
        pid_alive: true,
        attach_state: 'live_process_without_management_socket',
        failure_code: 'management_socket_unreachable',
        socket_reachable: false,
      },
    }));
    return;
  }
  if (state.installed !== true) {
    process.exit(127);
  }
  process.stdout.write(JSON.stringify({
    local_ui_url: 'http://127.0.0.1:39001/',
    local_ui_urls: ['http://127.0.0.1:39001/'],
    runtime_control: {
      protocol_version: 'redeven-runtime-control-v1',
      base_url: 'http://127.0.0.1:39002/',
      token: 'runtime-control-token',
      desktop_owner_id: 'desktop-owner-test',
      expires_at_unix_ms: Date.now() + 60 * 60 * 1000,
    },
    password_required: false,
    exposure: {
      scope: 'loopback',
      transport: 'plaintext',
      password_required: false,
    },
    effective_run_mode: 'local',
    desktop_managed: true,
    pid: 4242,
    runtime_service: runtimeServiceForScenario(),
  }));
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
  if (scenario === 'runtime_control_forward_early_exit' && isRuntimeControlForward) {
    appendLog('runtime_control_forward_early_exit', { local_port: localPort, remote_port: remotePort });
    process.stderr.write('simulated runtime-control forward exit\n');
    setTimeout(() => process.exit(255), 50);
    setInterval(() => {}, 1000);
    return;
  }
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
      appendLog('forward_health_probe');
      if (scenario === 'forwarded_network_reset') {
        request.socket.destroy();
        return;
      }
      if (scenario === 'forwarded_invalid_response') {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'simulated invalid response' }));
        return;
      }
      const writeHealth = () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          success: true,
          data: {
            status: 'online',
            password_required: false,
            exposure: {
              scope: 'loopback',
              transport: 'plaintext',
              password_required: false,
            },
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
      };
      if (scenario === 'forwarded_delayed_health') {
        setTimeout(writeHealth, 350);
      } else if (scenario === 'forwarded_health_timeout') {
        setTimeout(writeHealth, 1000);
      } else {
        writeHealth();
      }
      return;
    }
    if (request.url === '/_redeven_proxy/env/') {
      appendLog('forward_env_shell_probe');
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(scenario === 'forwarded_invalid_env_shell'
        ? '<pre><a href="favicon.svg">favicon.svg</a><a href="logo.png">logo.png</a></pre>'
        : '<!doctype html><html><body><div id="root"></div><script type="module" src="/_redeven_proxy/env/assets/index.js"></script></body></html>');
      return;
    }
    if (request.url === '/_redeven_proxy/env/assets/index.js') {
      appendLog('forward_env_asset_probe');
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
    case 'redeven-ssh-runtime-status':
      appendLog('runtime_status', { script_args: remoteScriptArgs() });
      writeRuntimeStatus();
      process.exit(0);
      break;
    case 'redeven-ssh-probe-platform':
      appendLog('probe_platform');
      process.stdout.write('Linux\nx86_64\n');
      process.exit(0);
      break;
    case 'redeven-ssh-runtime-helper-platform':
      process.stdout.write('Linux\nx86_64\n');
      process.exit(0);
      break;
    case 'redeven-ssh-create-upload-dir':
      appendLog('create_remote_temp_dir');
      process.stdout.write('/tmp/redeven-ssh-upload.fake\n');
      process.exit(0);
      break;
    case 'redeven-ssh-remote-install':
      appendLog('remote_install', {
        install_script_url: remoteScriptArgs()[2] || args[args.length - 1] || '',
        release_tag: remoteInstallReleaseTag(),
      });
      writeState({ ...readState(), staged_version: remoteInstallReleaseTag() });
      process.stdout.write('/home/test/.redeven/runtime/managed.staging.remote\n');
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
      if (scenario === 'upload_install_fail') {
        process.stderr.write('simulated upload install failure\n');
        process.exit(2);
      }
      writeState({ ...readState(), staged_version: remoteInstallReleaseTag() });
      process.stdout.write('/home/test/.redeven/runtime/managed.staging.upload\n');
      process.exit(0);
      break;
    case 'redeven-ssh-activate-runtime': {
      const state = readState();
      appendLog('activate_runtime', {
        staged_root: remoteScriptArgs()[2] || '',
        release_tag: remoteInstallReleaseTag(),
      });
      writeState({
        ...state,
        installed: true,
        installed_version: state.staged_version || remoteInstallReleaseTag(),
        staged_version: undefined,
      });
      process.exit(0);
      break;
    }
    case 'redeven-ssh-cleanup-path':
      appendLog('cleanup_remote_path', { remote_path: remoteScriptArgs()[0] || args[args.length - 1] || '' });
      process.exit(0);
      break;
    case 'redeven-ssh-start':
      appendLog('start_runtime', { session_token: remoteStartSessionToken(), state_root: remoteRuntimeStateRoot() });
      {
        const state = readState();
        const wasLive = state.runtime_live === true;
        writeState({
          ...state,
          installed: true,
          stopped: false,
          runtime_live: true,
          runtime_pid: wasLive || state.stopped !== true ? (state.runtime_pid || 4242) : (state.runtime_pid || 4242) + 1,
          runtime_started_at: wasLive || state.stopped !== true ? (state.runtime_started_at || 1000) : (state.runtime_started_at || 1000) + 1000,
          restarted: state.restarted === true || state.stopped === true,
          startup_session_token: remoteStartSessionToken(),
        });
      }
      if (scenario === 'blocked_report') {
        process.exit(1);
      }
      if (scenario === 'quick_exit_report') {
        process.exit(0);
      }
      terminateLater('control_terminated');
      break;
    case 'redeven-ssh-read-report':
      if (readState().startup_session_token !== remoteScriptArgs()[2]) {
        process.exit(1);
      }
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
      if (scenario === 'transient_blocked_report') {
        const state = readState();
        if (state.transient_block_seen !== true) {
          writeState({ ...state, installed: true, transient_block_seen: true });
          process.stdout.write(JSON.stringify({
            status: 'blocked',
            code: 'live_process_without_management_socket',
            message: 'A Redeven runtime process is alive, but its management socket is not reachable.',
            lock_owner: {
              pid: 4242,
              desktop_managed: true,
              desktop_owner_id: 'desktop-owner-test',
            },
            diagnostics: {
              lock_pid: 4242,
              pid_alive: true,
              attach_state: 'live_process_without_management_socket',
              failure_code: 'management_socket_unreachable',
              socket_reachable: false,
            },
          }));
          process.exit(0);
        }
      }
      const state = readState();
      if (state.runtime_live !== true) {
        process.exit(1);
      }
      const attachedUnsupported = (
        (scenario === 'attached_unsupported_idle' || scenario === 'attached_unsupported_active')
        && state.restarted !== true
        && state.stopped !== true
      );
      const reportRuntimeControl = !(
        (scenario === 'missing_runtime_control_idle' || scenario === 'missing_runtime_control_active')
        && state.restarted !== true
        && state.stopped !== true
      );
      process.stdout.write(JSON.stringify({
        ...(attachedUnsupported ? { status: 'attached' } : {}),
        local_ui_url: 'http://127.0.0.1:39001/',
        local_ui_urls: ['http://127.0.0.1:39001/'],
        ...(reportRuntimeControl ? {
          runtime_control: {
            protocol_version: 'redeven-runtime-control-v1',
            base_url: 'http://127.0.0.1:39002/',
            token: 'runtime-control-token',
            desktop_owner_id: 'desktop-owner-test',
            expires_at_unix_ms: Date.now() + 60 * 60 * 1000,
          },
        } : {}),
        password_required: false,
        exposure: {
          scope: 'loopback',
          transport: 'plaintext',
          password_required: false,
        },
        effective_run_mode: 'local',
        desktop_managed: true,
        pid: Number(state.runtime_pid || 4242),
        runtime_service: runtimeServiceForScenario(),
      }));
      process.exit(0);
      break;
    case 'redeven-ssh-runtime-process-helper': {
      const state = readState();
      const helperOperation = remoteScriptArgs()[2];
      const stopOperation = helperOperation === 'stop';
      const live = state.runtime_live === true;
      const runtimePID = Number(state.runtime_pid || 4242);
      const runtimeStartedAt = Number(state.runtime_started_at || 1000);
      const foreignOwner = scenario === 'foreign_owner';
      const duplicateCurrentOwner = scenario === 'duplicate_current_owner';
      const inventoryRuntimeVersion = (
        (scenario === 'attached_unsupported_idle' || scenario === 'attached_unsupported_active')
        && state.restarted !== true
      ) ? 'v0.5.9' : (state.installed_version || 'v1.2.3');
      const instances = live ? [{
        pid: runtimePID,
        process_started_at_unix_ms: runtimeStartedAt,
        desktop_owner_id: foreignOwner ? 'another-desktop' : 'desktop-owner-test',
        state_root: '/home/test/.redeven',
        executable_path: '/home/test/.redeven/runtime/managed/bin/redeven',
        executable_device: 1,
        executable_inode: 2,
        namespace_id: 'mnt:[host]',
        runtime_version: inventoryRuntimeVersion,
        identity_status: 'verified',
        owner_status: foreignOwner ? 'foreign' : 'current',
        layout_status: 'current',
        owner_evidence: 'process_environment',
        stop_authority: foreignOwner ? 'confirmed_takeover' : 'automatic',
      }] : [];
      if (duplicateCurrentOwner) {
        instances.push({
          ...instances[0],
          pid: runtimePID + 1,
          process_started_at_unix_ms: runtimeStartedAt + 1,
        });
      }
      const before = {
        schema_version: 2,
        scope: { runtime_root: '/home/test/.redeven', state_root: '/home/test/.redeven', desktop_owner_id: 'desktop-owner-test', user_identity: 'test', namespace_id: 'mnt:[host]' },
        inventory_digest: live ? 'a'.repeat(64) : 'b'.repeat(64),
        instances,
        summary: { automatic: foreignOwner ? 0 : instances.length, confirmed_takeover: foreignOwner ? instances.length : 0, blocked: 0 },
      };
      if (stopOperation) {
        appendLog('stop_runtime', { count: before.instances.length });
        writeState({ ...state, stopped: true, runtime_live: false });
        const after = { ...before, inventory_digest: 'b'.repeat(64), instances: [], summary: { automatic: 0, confirmed_takeover: 0, blocked: 0 } };
        process.stdout.write(JSON.stringify({ schema_version: 2, before, after, stopped: before.instances }));
      } else {
        process.stdout.write(JSON.stringify(before));
      }
      process.exit(0);
      break;
    }
    case 'redeven-ssh-stop': {
      const state = readState();
      const live = state.runtime_live === true;
      const before = { schema_version: 2, scope: { runtime_root: '/home/test/.redeven', state_root: '/home/test/.redeven', desktop_owner_id: 'desktop-owner-test', user_identity: 'test', namespace_id: 'mnt:[host]' }, inventory_digest: live ? 'a'.repeat(64) : 'b'.repeat(64), instances: live ? [{ pid: 4242, process_started_at_unix_ms: 1000, desktop_owner_id: 'desktop-owner-test', state_root: '/home/test/.redeven', executable_path: '/home/test/.redeven/runtime/managed/bin/redeven', executable_device: 1, executable_inode: 2, namespace_id: 'mnt:[host]', identity_status: 'verified', owner_status: 'current', layout_status: 'current', owner_evidence: 'process_environment', stop_authority: 'automatic' }] : [], summary: { automatic: live ? 1 : 0, confirmed_takeover: 0, blocked: 0 } };
      appendLog('stop_runtime', { count: before.instances.length });
      writeState({ ...state, stopped: true, runtime_live: false });
      const after = { ...before, inventory_digest: 'b'.repeat(64), instances: [], summary: { automatic: 0, confirmed_takeover: 0, blocked: 0 } };
      process.stdout.write(JSON.stringify({ schema_version: 2, before, after, stopped: before.instances }));
      process.exit(0);
      break;
    }
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
      || scenario === 'missing_runtime_control_idle'
      || scenario === 'missing_runtime_control_active'
      || scenario === 'attached_unsupported_idle'
      || scenario === 'attached_unsupported_active'
      || scenario === 'persistent_version_mismatch'
      || scenario === 'forwarded_blocked_readiness'
      || scenario === 'forwarded_invalid_env_shell'
      || scenario === 'forwarded_delayed_health'
      || scenario === 'forwarded_health_timeout'
      || scenario === 'forwarded_network_reset'
      || scenario === 'forwarded_invalid_response'
      || scenario === 'runtime_control_forward_early_exit'
      || scenario === 'no_report'
      || scenario === 'quick_exit_report'
      || scenario === 'blocked_report'
      || scenario === 'status_blocked_without_socket'
      || scenario === 'duplicate_current_owner'
      || scenario === 'foreign_owner',
    installed_version: 'v1.2.3',
    runtime_live: scenario === 'ready'
      || scenario === 'missing_runtime_control_idle'
      || scenario === 'missing_runtime_control_active'
      || scenario === 'attached_unsupported_idle'
      || scenario === 'attached_unsupported_active'
      || scenario === 'persistent_version_mismatch'
      || scenario === 'forwarded_blocked_readiness'
      || scenario === 'forwarded_invalid_env_shell'
      || scenario === 'forwarded_delayed_health'
      || scenario === 'forwarded_health_timeout'
      || scenario === 'forwarded_network_reset'
      || scenario === 'forwarded_invalid_response'
      || scenario === 'runtime_control_forward_early_exit'
      || scenario === 'no_report'
      || scenario === 'quick_exit_report'
      || scenario === 'blocked_report'
      || scenario === 'status_blocked_without_socket'
      || scenario === 'duplicate_current_owner'
      || scenario === 'foreign_owner',
    runtime_pid: 4242,
    runtime_started_at: 1000,
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

async function waitForFakeSSHEvent(
  fixture: FakeSSHFixture,
  eventName: string,
  timeoutMs = SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS,
): Promise<void> {
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
  const previousCompatibilityEpoch = process.env.REDEVEN_FAKE_SSH_COMPATIBILITY_EPOCH;
  process.env.REDEVEN_FAKE_SSH_LOG = fixture.logPath;
  process.env.REDEVEN_FAKE_SSH_STATE = fixture.statePath;
  process.env.REDEVEN_FAKE_SSH_SCENARIO = fixture.scenario;
  process.env.REDEVEN_FAKE_SSH_COMPATIBILITY_EPOCH = String(RUNTIME_SERVICE_COMPATIBILITY_EPOCH);
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
    if (previousCompatibilityEpoch === undefined) {
      delete process.env.REDEVEN_FAKE_SSH_COMPATIBILITY_EPOCH;
    } else {
      process.env.REDEVEN_FAKE_SSH_COMPATIBILITY_EPOCH = previousCompatibilityEpoch;
    }
  }
}

function targetFor(strategy: DesktopSSHBootstrapStrategy): DesktopSSHEnvironmentDetails {
  return {
    ssh_destination: 'devbox',
    ssh_port: 2222,
    auth_mode: 'key_agent',
    runtime_root: 'remote_default',
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
    runtimeProcessIntent?: 'start' | 'restart' | 'update';
    runtimeReleaseTag?: string;
    allowActiveWorkReplacement?: boolean;
    requireDesktopModelSource?: boolean;
    signal?: AbortSignal;
  }> = {},
): Promise<ManagedSSHRuntime> {
  const runtime = await withFakeSSHEnv(fixture, () => startManagedSSHRuntime({
    target: options.target ?? targetFor(strategy),
    runtimeReleaseTag: options.runtimeReleaseTag ?? 'v1.2.3',
    desktopOwnerID: 'desktop-owner-test',
    sshBinary: fixture.sshBinary,
    sourceRuntimeRoot: options.sourceRuntimeRoot,
    forceRuntimeUpdate: options.forceRuntimeUpdate,
    runtimeProcessIntent: options.runtimeProcessIntent,
    allowActiveWorkReplacement: options.allowActiveWorkReplacement,
    tempRoot: fixture.root,
    assetCacheRoot: path.join(fixture.root, 'asset-cache'),
    startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
    probeTimeoutMs: options.probeTimeoutMs ?? 5_000,
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
    requireDesktopModelSource: options.requireDesktopModelSource === true,
    signal: options.signal,
  }));
  const stop = async () => await withFakeSSHEnv(fixture, runtime.stop);
  return {
    ...runtime,
    runtime_handle: {
      ...runtime.runtime_handle,
      stop,
    },
    stop,
  };
}

async function ensureReadyWithFakeSSH(
  fixture: FakeSSHFixture,
  strategy: DesktopSSHBootstrapStrategy,
): Promise<ManagedSSHRuntimeReady> {
  return withFakeSSHEnv(fixture, () => ensureManagedSSHRuntimeReady({
    target: targetFor(strategy),
    runtimeReleaseTag: 'v1.2.3',
    desktopOwnerID: 'desktop-owner-test',
    sshBinary: fixture.sshBinary,
    tempRoot: fixture.root,
    assetCacheRoot: path.join(fixture.root, 'asset-cache'),
    startupTimeoutMs: SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS,
    probeTimeoutMs: SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS,
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
  }));
}

async function openConnectionWithFakeSSH(
  fixture: FakeSSHFixture,
  ready: ManagedSSHRuntimeReady,
  options: Readonly<{ probeTimeoutMs?: number }> = {},
): Promise<ManagedSSHRuntime> {
  return withFakeSSHEnv(fixture, () => openManagedSSHRuntimeConnection({
    target: targetFor('auto'),
    ready,
    sshBinary: fixture.sshBinary,
    tempRoot: fixture.root,
    probeTimeoutMs: options.probeTimeoutMs ?? 5_000,
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
  }));
}

async function captureDesktopOperationFailure(run: () => Promise<unknown>): Promise<DesktopOperationFailurePresentation> {
  try {
    await run();
  } catch (error) {
    const presentation = (error as Readonly<{ presentation?: DesktopOperationFailurePresentation }>)?.presentation;
    if (presentation) {
      return presentation;
    }
    throw error;
  }
  throw new Error('expected Desktop operation failure');
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
  vi.unstubAllGlobals();
});

beforeEach(() => {
  installReleaseFetchMock(new Map([
    ['redeven_linux_amd64.tar.gz', Buffer.from('fake runtime process helper archive')],
  ]));
});

describe('sshRuntime integration', () => {
  it('passes the release tag to the SSH runtime status probe before manual start decisions', async () => {
    const fixture = await createFakeSSHFixture('ready');
    try {
      const probe = await withFakeSSHEnv(fixture, () => probeManagedSSHRuntimeStatus({
        target: targetFor('auto'),
        runtimeReleaseTag: 'v1.2.3',
        sshBinary: fixture.sshBinary,
        tempRoot: fixture.root,
        connectTimeoutSeconds: 1,
      }));

      expect(probe.status).toBe('ready');
      const events = await readFakeSSHEvents(fixture);
      const statusEvent = events.find((event) => event.event === 'runtime_status');
      expect(statusEvent?.data?.script_args).toEqual(['remote_default', 'remote_default', 'v1.2.3']);
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('reports blocked SSH status and stops the verified inventory instead of trusting its process id', async () => {
    const fixture = await createFakeSSHFixture('status_blocked_without_socket');
    try {
      const probe = await withFakeSSHEnv(fixture, () => probeManagedSSHRuntimeStatus({
        target: targetFor('auto'),
        runtimeReleaseTag: 'v1.2.3',
        sshBinary: fixture.sshBinary,
        tempRoot: fixture.root,
        connectTimeoutSeconds: 1,
      }));

      expect(probe).toMatchObject({
        status: 'blocked',
        report: {
          code: 'live_process_without_management_socket',
          lock_owner: {
            pid: 4242,
            desktop_managed: true,
          },
          diagnostics: {
            failure_code: 'management_socket_unreachable',
          },
        },
      });

      const processArgs = {
        target: targetFor('auto'),
        runtimeReleaseTag: 'v1.2.3',
        desktopOwnerID: 'desktop-owner-test',
        sshBinary: fixture.sshBinary,
        tempRoot: fixture.root,
        assetCacheRoot: path.join(fixture.root, 'asset-cache'),
        connectTimeoutSeconds: 1,
      };
      const inventory = await withFakeSSHEnv(fixture, () => inspectManagedSSHRuntimeProcesses(processArgs));
      expect(inventory.instances).toEqual([
        expect.objectContaining({ pid: 4242, owner_status: 'current', stop_authority: 'automatic' }),
      ]);
      const stopped = await withFakeSSHEnv(fixture, () => stopManagedSSHRuntimeProcesses(processArgs, inventory));
      expect(stopped.after.instances).toEqual([]);

      const events = await readFakeSSHEvents(fixture);
      expect(events.find((event) => event.event === 'stop_runtime')?.data).toEqual({ count: 1 });
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('waits through a transient startup report with an unreachable management socket', async () => {
    const fixture = await createFakeSSHFixture('transient_blocked_report');
    try {
      const ready = await ensureReadyWithFakeSSH(fixture, 'auto');

      expect(ready.startup.local_ui_url).toBe('http://127.0.0.1:39001/');
      const events = await readFakeSSHEvents(fixture);
      expect(events.filter((event) => event.event === 'read_report')).toHaveLength(2);
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('keeps SSH runtime readiness separate from the Open connection tunnel', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let ready: ManagedSSHRuntimeReady | null = null;
    try {
      ready = await ensureReadyWithFakeSSH(fixture, 'auto');
      expect(ready.startup.local_ui_url).toBe('http://127.0.0.1:39001/');
      expect(ready.runtime_handle.launch_mode).toBe('spawned');
      await waitForFakeSSHEvent(fixture, 'start_runtime');
    } finally {
      await ready?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'master_start',
      'probe_runtime',
      'start_runtime',
      'read_report',
    ]));
    expect(eventNames).not.toContain('forward_start');
    expect(eventNames).not.toContain('runtime_control_forward_start');
    await removeFakeSSHFixture(fixture);
  });

  it('opens SSH connection resources from a ready runtime without installing or starting it again', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let ready: ManagedSSHRuntimeReady | null = null;
    let runtime: ManagedSSHRuntime | null = null;
    try {
      ready = await ensureReadyWithFakeSSH(fixture, 'auto');
      await waitForFakeSSHEvent(fixture, 'start_runtime');
      const beforeOpenEventCount = (await readFakeSSHEvents(fixture)).length;
      runtime = await openConnectionWithFakeSSH(fixture, ready);
      expect(runtime.local_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      expect(runtime.runtime_control_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);

      const openEvents = (await readFakeSSHEvents(fixture)).slice(beforeOpenEventCount);
      const openEventNames = openEvents.map((event) => event.event);
      expect(openEventNames).toContain('forward_start');
      expect(openEventNames).toContain('runtime_control_forward_start');
      expect(openEventNames).not.toContain('probe_runtime');
      expect(openEventNames).not.toContain('remote_install');
      expect(openEventNames).not.toContain('upload_install');
      expect(openEventNames).not.toContain('start_runtime');
    } finally {
      await runtime?.disconnect();
      await ready?.disconnect();
    }

    await removeFakeSSHFixture(fixture);
  });

  it('opens through a 350ms forwarded health response and validates the Env App shell once', async () => {
    const fixture = await createFakeSSHFixture('forwarded_delayed_health');
    let ready: ManagedSSHRuntimeReady | null = null;
    let runtime: ManagedSSHRuntime | null = null;
    try {
      ready = await ensureReadyWithFakeSSH(fixture, 'auto');
      runtime = await openConnectionWithFakeSSH(fixture, ready, { probeTimeoutMs: 2_000 });

      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      const events = await readFakeSSHEvents(fixture);
      expect(events.filter((event) => event.event === 'forward_health_probe')).toHaveLength(1);
      expect(events.filter((event) => event.event === 'forward_env_shell_probe')).toHaveLength(1);
      expect(events.filter((event) => event.event === 'forward_env_asset_probe')).toHaveLength(1);
    } finally {
      await runtime?.disconnect();
      await ready?.disconnect();
      await removeFakeSSHFixture(fixture);
    }
  });

  it.each([
    {
      scenario: 'forwarded_health_timeout' as const,
      probeTimeoutMs: 250,
      code: 'ssh_forward_verification_timed_out',
      failureType: 'timeout',
    },
    {
      scenario: 'forwarded_network_reset' as const,
      probeTimeoutMs: 450,
      code: 'ssh_forward_network_failed',
      failureType: 'network_error',
    },
    {
      scenario: 'forwarded_invalid_response' as const,
      probeTimeoutMs: 450,
      code: 'ssh_forward_invalid_response',
      failureType: 'invalid_response',
    },
    {
      scenario: 'runtime_control_forward_early_exit' as const,
      probeTimeoutMs: 2_000,
      code: 'ssh_forward_unavailable',
      failureType: 'forward_unavailable',
    },
  ])('classifies $scenario and cleans every SSH connection resource', async ({
    scenario,
    probeTimeoutMs,
    code,
    failureType,
  }) => {
    const fixture = await createFakeSSHFixture(scenario);
    let ready: ManagedSSHRuntimeReady | null = null;
    try {
      ready = await ensureReadyWithFakeSSH(fixture, 'auto');
      const failure = await captureDesktopOperationFailure(() => openConnectionWithFakeSSH(
        fixture,
        ready!,
        { probeTimeoutMs },
      ));

      expect(failure.code).toBe(code);
      const diagnostic = failure.diagnostics?.find((item) => item.channel === 'forward_probe');
      expect(diagnostic?.text).toContain(`failure_type=${failureType}`);
      expect(diagnostic?.text).toContain('attempts=');
      expect(diagnostic?.text).toContain('request_budget_ms=');
      expect(diagnostic?.text).toContain('elapsed_ms=');
      expect(diagnostic?.text).not.toContain('runtime-control-token');
      expect(diagnostic?.text).not.toContain('simulated invalid response');

      await waitForFakeSSHEvent(fixture, 'forward_terminated');
      await waitForFakeSSHEvent(fixture, 'master_terminated');
      const eventNames = (await readFakeSSHEvents(fixture)).map((event) => event.event);
      if (scenario === 'runtime_control_forward_early_exit') {
        expect(eventNames).toContain('runtime_control_forward_early_exit');
      } else {
        expect(eventNames).toContain('runtime_control_forward_terminated');
      }
    } finally {
      await ready?.disconnect();
      await removeFakeSSHFixture(fixture);
    }
  });

  it('starts an already-installed remote runtime through a fake SSH control socket and local forward', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.local_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
      expect(runtime.startup.local_ui_url).toBe(runtime.local_forward_url);
      expect(runtime.startup.local_ui_urls).toEqual([runtime.local_forward_url]);
      expect(runtime.startup.password_required).toBe(false);
      expect(runtime.startup.exposure).toEqual({
        scope: 'loopback',
        transport: 'plaintext',
        password_required: false,
      });
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
          exposure: {
            scope: 'loopback',
            transport: 'plaintext',
            password_required: false,
          },
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

  it('does not reinstall an already-installed SSH runtime when the Desktop target changes to a dev build', async () => {
    const fixture = await createFakeSSHFixture('ready');
    await fs.writeFile(fixture.statePath, JSON.stringify({
      installed: true,
      installed_version: 'v0.6.10',
    }));
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        runtimeReleaseTag: 'v0.0.0-dev',
      });
      expect(runtime.startup.runtime_service?.runtime_version).toBe('v0.6.10');
    } finally {
      await runtime?.disconnect();
    }

    const state = JSON.parse(await fs.readFile(fixture.statePath, 'utf8')) as { installed_version?: string };
    expect(state.installed_version).toBe('v0.6.10');
    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain('probe_runtime');
    expect(eventNames).toContain('start_runtime');
    expect(eventNames).not.toContain('remote_install');
    expect(eventNames).not.toContain('upload_install');
    const probe = events.find((event) => event.event === 'probe_runtime');
    expect(probe?.data?.script_args).toEqual(['remote_default', 'v0.0.0-dev']);
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
      count: 1,
    });
    await removeFakeSSHFixture(fixture);
  });

  it('aborts a pending SSH startup and tears down long-lived SSH processes before opening a tunnel', async () => {
    const fixture = await createFakeSSHFixture('no_report');
    try {
      const abortController = new AbortController();
      const startup = startWithFakeSSH(fixture, 'auto', {
        startupTimeoutMs: 5_000,
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

  it('surfaces lifecycle update maintenance for an idle attached runtime before Desktop model source setup', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_idle');
    try {
      await expect(startWithFakeSSH(fixture, 'auto', {
        requireDesktopModelSource: true,
      })).rejects.toMatchObject({
        name: 'DesktopSSHRuntimeMaintenanceRequiredError',
        maintenance: expect.objectContaining({
          kind: 'desktop_model_source_requires_runtime_update',
          required_for: 'desktop_model_source',
          has_active_work: false,
        }),
      });

      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event)).not.toContain('stop_runtime');
      expect(events.map((event) => event.event)).not.toContain('runtime_control_forward_start');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('surfaces restart maintenance when an idle SSH runtime is missing Desktop runtime-control', async () => {
    const fixture = await createFakeSSHFixture('missing_runtime_control_idle');
    await expect(startWithFakeSSH(fixture, 'auto')).rejects.toMatchObject({
      name: 'DesktopSSHRuntimeMaintenanceRequiredError',
      maintenance: expect.objectContaining({
        kind: 'runtime_restart_required',
        required_for: 'open',
        can_desktop_restart: true,
        has_active_work: false,
      }),
    });

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain('read_report');
    expect(eventNames).not.toContain('stop_runtime');
    expect(eventNames).not.toContain('runtime_control_forward_start');
    expect(eventNames).not.toContain('forward_start');
    await removeFakeSSHFixture(fixture);
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('surfaces restart maintenance when an active SSH runtime is missing Desktop runtime-control', async () => {
    const fixture = await createFakeSSHFixture('missing_runtime_control_active');
    await expect(startWithFakeSSH(fixture, 'auto')).rejects.toMatchObject({
      name: 'DesktopSSHRuntimeMaintenanceRequiredError',
      maintenance: expect.objectContaining({
        kind: 'runtime_restart_required',
        required_for: 'open',
        can_desktop_restart: true,
        has_active_work: true,
        active_work_label: '1 terminal, 1 session, 1 port forward',
      }),
    });

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain('start_runtime');
    expect(eventNames).toContain('read_report');
    expect(eventNames).not.toContain('stop_runtime');
    expect(eventNames).not.toContain('runtime_control_forward_start');
    await removeFakeSSHFixture(fixture);
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('restarts an active SSH runtime missing Desktop runtime-control after explicit user action', async () => {
    const fixture = await createFakeSSHFixture('missing_runtime_control_active');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        allowActiveWorkReplacement: true,
      });
      expect(runtime.startup.runtime_control).toEqual(expect.objectContaining({
        protocol_version: 'redeven-runtime-control-v1',
        desktop_owner_id: 'desktop-owner-test',
      }));
      expect(runtime.runtime_control_forward_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
    } finally {
      await runtime?.disconnect();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'probe_runtime',
      'start_runtime',
      'stop_runtime',
      'runtime_control_forward_start',
      'forward_start',
    ]));
    expect(eventNames.filter((event) => event === 'start_runtime')).toHaveLength(2);
    expect(eventNames.filter((event) => event === 'remote_install')).toHaveLength(0);
    expect(eventNames.filter((event) => event === 'upload_install')).toHaveLength(0);
    expect(eventNames.indexOf('stop_runtime')).toBeLessThan(eventNames.indexOf('runtime_control_forward_start'));
    await removeFakeSSHFixture(fixture);
  });

  it('surfaces post-restart SSH runtime identity mismatch diagnostics', async () => {
    const fixture = await createFakeSSHFixture('persistent_version_mismatch');
    try {
      let caught: unknown;
      try {
        await startWithFakeSSH(fixture, 'auto', {
          forceRuntimeUpdate: true,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        name: 'DesktopOperationFailureError',
        presentation: expect.objectContaining({
          title: 'SSH Runtime Restart Failed',
          summary: 'Desktop restarted the SSH runtime, but the running Runtime Service still does not match this session.',
          detail: expect.stringContaining('expected_runtime_version=v1.2.3'),
        }),
      });
      expect(caught).toMatchObject({
        presentation: expect.objectContaining({
          detail: expect.stringContaining('observed_runtime_version=v1.2.2'),
        }),
      });
      expect(caught).toMatchObject({
        presentation: expect.objectContaining({
          detail: expect.stringContaining('observed_pid=4244'),
        }),
      });
    } finally {
      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event).filter((event) => event === 'start_runtime')).toHaveLength(2);
      expect(events.map((event) => event.event)).toContain('stop_runtime');
      await removeFakeSSHFixture(fixture);
    }
  });

  it('blocks lifecycle update for an active attached runtime before Desktop model source setup', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_active');
    try {
      await expect(startWithFakeSSH(fixture, 'auto', {
        requireDesktopModelSource: true,
      })).rejects.toMatchObject({
        name: 'DesktopSSHRuntimeMaintenanceRequiredError',
        maintenance: expect.objectContaining({
          kind: 'desktop_model_source_requires_runtime_update',
          required_for: 'desktop_model_source',
          has_active_work: true,
        }),
      });

      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event)).not.toContain('stop_runtime');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

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

  it('keeps Restart version-stable when the installed SSH runtime package is missing', async () => {
    const fixture = await createFakeSSHFixture('remote_install');
    try {
      await expect(startWithFakeSSH(fixture, 'remote_install', {
        runtimeProcessIntent: 'restart',
      })).rejects.toThrow('managed runtime binary is missing');

      const events = await readFakeSSHEvents(fixture);
      const eventNames = events.map((event) => event.event);
      expect(eventNames).toContain('probe_runtime');
      expect(eventNames).not.toContain('remote_install');
      expect(eventNames).not.toContain('upload_install');
      expect(eventNames).not.toContain('start_runtime');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('fails closed before mutation when the current Runtime helper package cannot be prepared', async () => {
    const fixture = await createFakeSSHFixture('remote_install');
    installReleaseFetchMock(new Map());
    try {
      await expect(startWithFakeSSH(fixture, 'auto')).rejects.toThrow(
        'Desktop could not prepare the linux/amd64 Redeven runtime package.',
      );
    } finally {
      const events = await readFakeSSHEvents(fixture);
      const eventNames = events.map((event) => event.event);
      expect(eventNames).not.toContain('remote_install');
      expect(eventNames).not.toContain('upload_archive');
      expect(eventNames).not.toContain('upload_install');
      await removeFakeSSHFixture(fixture);
    }
  });

  it('does not fall back to remote install after an upload install has started', async () => {
    const fixture = await createFakeSSHFixture('upload_install_fail');
    installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('fake archive')],
    ]));

    await expect(startWithFakeSSH(fixture, 'auto')).rejects.toThrow(
      'Desktop could not install the uploaded linux/amd64 Redeven package on the remote host.',
    );

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain('upload_archive');
    expect(eventNames).toContain('upload_install');
    expect(eventNames).not.toContain('remote_install');
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
    const prepareIndex = eventNames.indexOf('remote_install');
    const stopIndex = eventNames.indexOf('stop_runtime');
    const activateIndex = eventNames.indexOf('activate_runtime');
    const startIndex = eventNames.indexOf('start_runtime');
    expect(prepareIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThan(prepareIndex);
    expect(activateIndex).toBeGreaterThan(stopIndex);
    expect(startIndex).toBeGreaterThan(activateIndex);
    await removeFakeSSHFixture(fixture);
  });

  it('does not stop, activate, or start an SSH update when inventory reports a foreign owner', async () => {
    const fixture = await createFakeSSHFixture('foreign_owner');
    try {
      await expect(startWithFakeSSH(fixture, 'remote_install', {
        forceRuntimeUpdate: true,
      })).rejects.toMatchObject({ name: 'RuntimeProcessTakeoverRequiredError' });

      const events = await readFakeSSHEvents(fixture);
      const eventNames = events.map((event) => event.event);
      expect(eventNames).toContain('remote_install');
      expect(eventNames).not.toContain('stop_runtime');
      expect(eventNames).not.toContain('activate_runtime');
      expect(eventNames).not.toContain('start_runtime');
      const state = JSON.parse(await fs.readFile(fixture.statePath, 'utf8')) as { installed_version?: string };
      expect(state.installed_version).toBe('v1.2.3');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('keeps Start observational when more than one current-owner SSH runtime is verified', async () => {
    const fixture = await createFakeSSHFixture('duplicate_current_owner');
    try {
      await expect(startWithFakeSSH(fixture, 'auto')).rejects.toMatchObject({
        name: 'DesktopSSHRuntimeMaintenanceRequiredError',
        maintenance: expect.objectContaining({
          kind: 'runtime_restart_required',
          can_desktop_restart: true,
        }),
      });

      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event)).not.toContain('start_runtime');
      expect(events.map((event) => event.event)).not.toContain('stop_runtime');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('replaces an active unsupported runtime after the user explicitly requests an update', async () => {
    const fixture = await createFakeSSHFixture('attached_unsupported_active');
    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        forceRuntimeUpdate: true,
        allowActiveWorkReplacement: true,
        requireDesktopModelSource: true,
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
    expect(eventNames.filter((event) => event === 'start_runtime')).toHaveLength(1);
    await removeFakeSSHFixture(fixture);
  }, 10_000);

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
    const fetchMock = installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('fake archive')],
    ]));

    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'desktop_upload');
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(releaseArchiveFetchCount(fetchMock, 'redeven_linux_amd64.tar.gz')).toBe(1);
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

  it('reuses one local release download across many SSH host uploads on the same platform', async () => {
    const fixtures = await Promise.all([
      createFakeSSHFixture('desktop_upload'),
      createFakeSSHFixture('desktop_upload'),
      createFakeSSHFixture('desktop_upload'),
    ]);
    const sharedCacheRoot = path.join(fixtures[0].root, 'shared-runtime-cache');
    const fetchMock = installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('shared fake archive')],
    ]));
    let runtimes: ManagedSSHRuntime[] = [];
    try {
      for (const fixture of fixtures) {
        const runtime = await withFakeSSHEnv(fixture, () => startManagedSSHRuntime({
          target: targetFor('desktop_upload'),
          runtimeReleaseTag: 'v1.2.3',
          desktopOwnerID: 'desktop-owner-test',
          sshBinary: fixture.sshBinary,
          tempRoot: fixture.root,
          assetCacheRoot: sharedCacheRoot,
          startupTimeoutMs: 2_500,
          probeTimeoutMs: 2_500,
          stopTimeoutMs: 500,
          connectTimeoutSeconds: 1,
        }));
        runtimes.push(runtime);
      }
    } finally {
      await Promise.all(runtimes.map((runtime) => runtime.stop().catch(() => undefined)));
    }

    expect(releaseArchiveFetchCount(fetchMock, 'redeven_linux_amd64.tar.gz')).toBe(1);
    for (const fixture of fixtures) {
      const events = await readFakeSSHEvents(fixture);
      expect(events.find((event) => event.event === 'upload_archive')?.data?.bytes).toBe(Buffer.byteLength('shared fake archive'));
      await removeFakeSSHFixture(fixture);
    }
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
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('does not rebuild or upload source-dev runtime when the remote runtime is already ready', async () => {
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
    expect(eventNames).toContain('probe_runtime');
    expect(eventNames).toContain('start_runtime');
    expect(eventNames).not.toContain('probe_platform');
    expect(eventNames).not.toContain('upload_archive');
    expect(eventNames).not.toContain('upload_install');
    expect(eventNames).not.toContain('remote_install');
    await removeFakeSSHFixture(fixture);
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

  it('rebuilds and uploads source-dev runtime when the user explicitly requests an update', async () => {
    const fixture = await createFakeSSHFixture('ready');
    const source = await createFakeSourceRuntimeRoot(fixture.root);
    const previousPath = process.env.PATH;
    process.env.PATH = `${source.binDir}${path.delimiter}${previousPath ?? ''}`;

    let runtime: ManagedSSHRuntime | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        sourceRuntimeRoot: source.sourceRoot,
        forceRuntimeUpdate: true,
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
    await removeFakeSSHFixture(fixture);
  }, SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS);

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
