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
  probeManagedSSHRuntimeStatus,
  stopManagedSSHRuntimeProcesses,
  type ManagedSSHRuntimeReady,
  type StartManagedSSHRuntimeArgs,
} from './sshRuntime';
import type { DesktopSSHBootstrapStrategy, DesktopSSHEnvironmentDetails } from '../shared/desktopSSH';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import { RUNTIME_SERVICE_COMPATIBILITY_EPOCH } from '../shared/runtimeService';
import { DefaultDesktopSSHTransportManager } from './sshTransportManager';

type FakeSSHScenario =
  | 'ready'
  | 'remote_install'
  | 'desktop_upload'
  | 'upload_install_fail'
  | 'upload_temp_dir_fail'
  | 'upload_temp_dir_connection_interrupted'
  | 'upload_install_connection_interrupted'
  | 'report_connection_interrupted'
  | 'master_readiness_noise'
  | 'master_readiness_timeout'
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
  transportManager: DefaultDesktopSSHTransportManager;
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
  return {
    runtime_version: String(state.installed_version || 'v1.2.3'),
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

function runtimeServiceForScenario() {
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

function interruptControlConnection(message) {
  writeState({ ...readState(), control_interrupted: true });
  process.stderr.write(message + '\n');
  setTimeout(() => process.exit(255), 40);
}

function startMaster() {
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
  const monitor = setInterval(() => {
    if (readState().control_interrupted !== true) return;
    clearInterval(monitor);
    appendLog('master_interrupted');
    process.stderr.write('Connection to devbox closed by remote host.\n');
    process.exit(255);
  }, 5);
  const finish = () => {
    clearInterval(monitor);
    appendLog('master_terminated');
    setTimeout(() => process.exit(0), 10);
  };
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);
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

if (args.includes('-O') && args.includes('check')) {
  appendLog('master_check', { socket: controlSocketPath() });
  const state = readState();
  const readinessCheckShouldFail = scenario === 'master_readiness_timeout'
    || (scenario === 'master_readiness_noise' && Number(state.master_check_count || 0) < 2);
  if (readinessCheckShouldFail) {
    writeState({ ...state, master_check_count: Number(state.master_check_count || 0) + 1 });
    process.stderr.write('Control socket connect(' + controlSocketPath() + '): No such file or directory\n');
    process.exit(255);
  }
  if (state.control_interrupted === true) {
    process.stderr.write('Control socket connect(' + controlSocketPath() + '): No such file or directory\n');
    process.exit(255);
  }
  process.exit(0);
}

if (args.includes('-M') && args.includes('-N')) {
  startMaster();
} else {
  if (readState().control_interrupted === true) {
    process.stderr.write('Control socket connect(' + controlSocketPath() + '): No such file or directory\n');
    process.exit(255);
  }
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
      if (scenario === 'upload_temp_dir_fail') {
        process.stderr.write("mktemp: failed to create directory via template '/tmp/redeven-ssh-upload.XXXXXX': Permission denied\n");
        process.exit(1);
      }
      if (scenario === 'upload_temp_dir_connection_interrupted') {
        interruptControlConnection('Connection closed by remote host during upload directory creation.');
        break;
      }
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
      if (scenario === 'upload_install_connection_interrupted') {
        interruptControlConnection('Connection closed by remote host during uploaded runtime installation.');
        break;
      }
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
        setTimeout(() => process.exit(1), 250);
        setInterval(() => {}, 1000);
        break;
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
      if (scenario === 'report_connection_interrupted') {
        interruptControlConnection('Connection closed by remote host while reading the startup report.');
        break;
      }
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
      const inventoryRuntimeVersion = state.installed_version || 'v1.2.3';
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
      || scenario === 'report_connection_interrupted'
      || scenario === 'master_readiness_noise'
      || scenario === 'no_report'
      || scenario === 'quick_exit_report'
      || scenario === 'blocked_report'
      || scenario === 'status_blocked_without_socket'
      || scenario === 'duplicate_current_owner'
      || scenario === 'foreign_owner',
    installed_version: 'v1.2.3',
    runtime_live: scenario === 'ready'
      || scenario === 'report_connection_interrupted'
      || scenario === 'master_readiness_noise'
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
    transportManager: new DefaultDesktopSSHTransportManager({
      readyPollMs: 10,
      dependencies: { tempRoot: root },
    }),
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
    target?: DesktopSSHEnvironmentDetails;
    sourceRuntimeRoot?: string;
    forceRuntimeUpdate?: boolean;
    runtimeProcessIntent?: 'start' | 'restart' | 'update';
    runtimeReleaseTag?: string;
    allowActiveWorkReplacement?: boolean;
    signal?: AbortSignal;
    onLog?: StartManagedSSHRuntimeArgs['onLog'];
  }> = {},
): Promise<ManagedSSHRuntimeReady> {
  const runtime = await withFakeSSHEnv(fixture, () => ensureManagedSSHRuntimeReady({
    sshTransportManager: fixture.transportManager,
    sshCredentialScope: fixture.root,
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
    stopTimeoutMs: 500,
    connectTimeoutSeconds: 1,
    signal: options.signal,
    onLog: options.onLog,
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
    sshTransportManager: fixture.transportManager,
    sshCredentialScope: fixture.root,
    target: targetFor(strategy),
    runtimeReleaseTag: 'v1.2.3',
    desktopOwnerID: 'desktop-owner-test',
    sshBinary: fixture.sshBinary,
    tempRoot: fixture.root,
    assetCacheRoot: path.join(fixture.root, 'asset-cache'),
    startupTimeoutMs: SSH_RUNTIME_MAINTENANCE_TEST_TIMEOUT_MS,
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
  await fixture.transportManager.dispose();
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
        sshTransportManager: fixture.transportManager,
        sshCredentialScope: fixture.root,
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
        sshTransportManager: fixture.transportManager,
        sshCredentialScope: fixture.root,
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
        sshTransportManager: fixture.transportManager,
        sshCredentialScope: fixture.root,
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

  it('keeps SSH runtime readiness separate from the Desktop bridge session', async () => {
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
    const sshArgs = events.flatMap((event) => event.args);
    expect(sshArgs).not.toContain('-L');
    expect(sshArgs.join(' ')).not.toContain('ExitOnForwardFailure');
    await removeFakeSSHFixture(fixture);
  });

  it('does not reinstall an already-installed SSH runtime when the Desktop target changes to a dev build', async () => {
    const fixture = await createFakeSSHFixture('ready');
    await fs.writeFile(fixture.statePath, JSON.stringify({
      installed: true,
      installed_version: 'v0.6.10',
    }));
    let runtime: ManagedSSHRuntimeReady | null = null;
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
    let runtime: ManagedSSHRuntimeReady | null = null;
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
      'control_terminated',
    ]));
    expect(events.map((event) => event.event)).not.toContain('master_terminated');
    expect(events.find((event) => event.event === 'stop_runtime')?.data).toEqual({
      count: 1,
    });
    await fixture.transportManager.dispose();
    expect((await readFakeSSHEvents(fixture)).map((event) => event.event)).toContain('master_terminated');
    await removeFakeSSHFixture(fixture);
  });

  it('aborts a pending SSH startup without closing the reusable SSH master', async () => {
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
      await waitForFakeSSHEvent(fixture, 'control_terminated');

      const events = await readFakeSSHEvents(fixture);
      expect(events.map((event) => event.event)).toEqual(expect.arrayContaining([
        'master_start',
        'start_runtime',
        'control_terminated',
      ]));
      expect(events.map((event) => event.event)).not.toContain('master_terminated');
      await fixture.transportManager.dispose();
      await waitForFakeSSHEvent(fixture, 'master_terminated');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('uses a readiness report even when the remote start command exits quickly', async () => {
    const fixture = await createFakeSSHFixture('quick_exit_report');
    let runtime: ManagedSSHRuntimeReady | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto');
      expect(runtime.startup.local_ui_url).toBe('http://127.0.0.1:39001/');
      expect(runtime.startup.local_ui_urls).toEqual(['http://127.0.0.1:39001/']);
      expect(runtime.runtime_handle.launch_mode).toBe('spawned');
    } finally {
      await runtime?.stop();
    }

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'start_runtime',
      'read_report',
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
    expect(eventNames).not.toContain('stop_runtime');
    await removeFakeSSHFixture(fixture);
  });

  it('runs the remote installer when the probe reports a missing runtime', async () => {
    const fixture = await createFakeSSHFixture('remote_install');
    let runtime: ManagedSSHRuntimeReady | null = null;
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

  it('reports an unavailable remote upload directory while the SSH control session remains healthy', async () => {
    const fixture = await createFakeSSHFixture('upload_temp_dir_fail');
    installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('fake archive')],
    ]));
    try {
      const failure = await captureDesktopOperationFailure(() => startWithFakeSSH(fixture, 'desktop_upload'));

      expect(failure).toMatchObject({
        code: 'ssh_upload_directory_unavailable',
        title_key: 'progress.sshUploadDirectoryUnavailableTitle',
        summary_key: 'progress.sshUploadDirectoryUnavailableSummary',
        detail_key: 'progress.sshUploadDirectoryUnavailableDetail',
        recovery_hint_key: 'progress.sshUploadDirectoryUnavailableRecoveryHint',
      });
      expect(failure.detail).toContain('SSH connection is still active');
      expect(failure.diagnostics?.find((item) => item.channel === 'control_stderr')?.text).toContain('Permission denied');

      const eventNames = (await readFakeSSHEvents(fixture)).map((event) => event.event);
      expect(eventNames).toContain('create_remote_temp_dir');
      expect(eventNames).toContain('master_check');
      expect(eventNames).not.toContain('upload_archive');
      expect(eventNames).not.toContain('upload_install');
      expect(eventNames).not.toContain('remote_install');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('classifies a lost control session during upload directory creation as an SSH interruption', async () => {
    const fixture = await createFakeSSHFixture('upload_temp_dir_connection_interrupted');
    installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('fake archive')],
    ]));
    try {
      const failure = await captureDesktopOperationFailure(() => startWithFakeSSH(fixture, 'desktop_upload'));

      expect(failure).toMatchObject({
        code: 'ssh_connection_interrupted',
        title_key: 'progress.sshConnectionInterruptedTitle',
        summary_key: 'progress.sshConnectionInterruptedSummary',
        detail_key: 'progress.sshConnectionInterruptedDetail',
        recovery_hint_key: 'progress.sshConnectionInterruptedRecoveryHint',
      });
      expect(failure.summary).not.toContain('temporary directory');
      expect(failure.summary).not.toContain('upload directory');
      const diagnostics = failure.diagnostics?.map((item) => item.text).join('\n') ?? '';
      expect(diagnostics).toContain('Connection closed by remote host');
      expect(diagnostics.match(/\[ssh -O check\]/gu)).toHaveLength(1);

      const eventNames = (await readFakeSSHEvents(fixture)).map((event) => event.event);
      expect(eventNames).toContain('master_interrupted');
      expect(eventNames).not.toContain('upload_archive');
      expect(eventNames).not.toContain('upload_install');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('uses the same SSH interruption contract when the uploaded runtime install loses ControlMaster', async () => {
    const fixture = await createFakeSSHFixture('upload_install_connection_interrupted');
    installReleaseFetchMock(new Map([
      ['redeven_linux_amd64.tar.gz', Buffer.from('fake archive')],
    ]));
    try {
      const failure = await captureDesktopOperationFailure(() => startWithFakeSSH(fixture, 'desktop_upload'));

      expect(failure.code).toBe('ssh_connection_interrupted');
      expect(failure.summary).toContain('reusable SSH connection ended');
      const eventNames = (await readFakeSSHEvents(fixture)).map((event) => event.event);
      expect(eventNames).toContain('upload_archive');
      expect(eventNames).toContain('upload_install');
      expect(eventNames).not.toContain('activate_runtime');
      expect(eventNames).not.toContain('start_runtime');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('stops startup-report polling immediately when the SSH control session is interrupted', async () => {
    const fixture = await createFakeSSHFixture('report_connection_interrupted');
    try {
      const failure = await captureDesktopOperationFailure(() => startWithFakeSSH(fixture, 'auto', {
        startupTimeoutMs: 5_000,
      }));

      expect(failure.code).toBe('ssh_connection_interrupted');
      expect(failure.summary).not.toContain('Timed out');
      const eventNames = (await readFakeSSHEvents(fixture)).map((event) => event.event);
      expect(eventNames).toContain('start_runtime');
      expect(eventNames.filter((event) => event === 'read_report')).toHaveLength(1);
      expect(eventNames).toContain('master_interrupted');
      expect(eventNames).not.toContain('forward_start');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('keeps expected control-socket readiness polling noise out of user diagnostics', async () => {
    const fixture = await createFakeSSHFixture('master_readiness_noise');
    const observedLogs: string[] = [];
    let runtime: ManagedSSHRuntimeReady | null = null;
    try {
      runtime = await startWithFakeSSH(fixture, 'auto', {
        onLog: (_stream, chunk) => observedLogs.push(chunk),
      });
      const events = await readFakeSSHEvents(fixture);
      expect(events.filter((event) => event.event === 'master_check').length).toBeGreaterThanOrEqual(3);
      expect(observedLogs.join('\n')).not.toContain('Control socket connect');
    } finally {
      await runtime?.disconnect();
      await removeFakeSSHFixture(fixture);
    }
  });

  it('records only the final failed liveness check when the control socket never becomes ready', async () => {
    const fixture = await createFakeSSHFixture('master_readiness_timeout');
    try {
      const failure = await captureDesktopOperationFailure(() => startWithFakeSSH(fixture, 'auto', {
        startupTimeoutMs: 350,
      }));

      expect(failure.code).toBe('ssh_connection_failed');
      const masterDiagnostic = failure.diagnostics?.find((item) => item.channel === 'master_stderr')?.text ?? '';
      expect(masterDiagnostic.match(/\[ssh -O check\]/gu)).toHaveLength(1);
      expect(masterDiagnostic.match(/Control socket connect/gu)).toHaveLength(1);
      const events = await readFakeSSHEvents(fixture);
      expect(events.filter((event) => event.event === 'master_check').length).toBeGreaterThanOrEqual(1);
      expect(events.map((event) => event.event)).not.toContain('probe_runtime');
    } finally {
      await removeFakeSSHFixture(fixture);
    }
  });

  it('reinstalls a release runtime when the user explicitly requests an update before restart', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntimeReady | null = null;
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

  it('allows password authentication by disabling SSH batch mode and configuring askpass', async () => {
    const fixture = await createFakeSSHFixture('ready');
    let runtime: ManagedSSHRuntimeReady | null = null;
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

    let runtime: ManagedSSHRuntimeReady | null = null;
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
    let runtimes: ManagedSSHRuntimeReady[] = [];
    try {
      for (const fixture of fixtures) {
        const runtime = await withFakeSSHEnv(fixture, () => ensureManagedSSHRuntimeReady({
          sshTransportManager: fixture.transportManager,
          sshCredentialScope: fixture.root,
          target: targetFor('desktop_upload'),
          runtimeReleaseTag: 'v1.2.3',
          desktopOwnerID: 'desktop-owner-test',
          sshBinary: fixture.sshBinary,
          tempRoot: fixture.root,
          assetCacheRoot: sharedCacheRoot,
          startupTimeoutMs: 2_500,
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

    let runtime: ManagedSSHRuntimeReady | null = null;
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

    let runtime: ManagedSSHRuntimeReady | null = null;
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

    let runtime: ManagedSSHRuntimeReady | null = null;
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
    })).rejects.toThrow('Timed out waiting for remote Redeven to report readiness over SSH.');

    const events = await readFakeSSHEvents(fixture);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toEqual(expect.arrayContaining([
      'master_start',
      'start_runtime',
      'read_report',
      'control_terminated',
    ]));
    expect(eventNames).not.toContain('master_terminated');
    const masterStart = events.find((event) => event.event === 'master_start');
    const socketPath = String(masterStart?.data?.socket ?? '');
    expect(socketPath).not.toBe('');
    await expect(fs.access(path.dirname(socketPath))).resolves.toBeUndefined();
    await fixture.transportManager.dispose();
    await expect(fs.access(path.dirname(socketPath))).rejects.toThrow();
    expect((await readFakeSSHEvents(fixture)).map((event) => event.event)).toContain('master_terminated');
    await removeFakeSSHFixture(fixture);
  });
});
