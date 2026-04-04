import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { loadExternalLocalUIStartup } from './runtimeState';
import { parseStartupReport, type StartupReport } from './startup';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import {
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';

const PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';
const DEFAULT_SSH_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_SSH_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_SSH_POLL_INTERVAL_MS = 200;
const MAX_RECENT_LOG_CHARS = 8_000;

type SpawnedSSHProcess = ChildProcessByStdio<null, Readable | null, Readable>;

type RecentLogs = Readonly<{
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
  forward_stderr: string;
}>;

type MutableRecentLogs = {
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
  forward_stderr: string;
};

type SSHCommandResult = Readonly<{
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

export type ManagedSSHRuntime = Readonly<{
  startup: StartupReport;
  local_forward_url: string;
  runtime_handle: DesktopSessionRuntimeHandle;
  stop: () => Promise<void>;
}>;

export type StartManagedSSHRuntimeArgs = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  sshBinary?: string;
  installScriptURL?: string;
  tempRoot?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  probeTimeoutMs?: number;
  onLog?: (stream: 'master_stderr' | 'control_stdout' | 'control_stderr' | 'forward_stderr', chunk: string) => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function appendRecentLog(existing: string, chunk: string): string {
  const next = existing + String(chunk ?? '');
  if (next.length <= MAX_RECENT_LOG_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_RECENT_LOG_CHARS);
}

function formatRecentLogs(logs: RecentLogs): string {
  const sections: string[] = [];
  for (const [name, value] of Object.entries(logs)) {
    const text = value.trim();
    if (text === '') {
      continue;
    }
    sections.push(`${name}:\n${text}`);
  }
  return sections.join('\n\n');
}

function readinessFailure(message: string, logs: RecentLogs): Error {
  const details = formatRecentLogs(logs);
  if (details === '') {
    return new Error(message);
  }
  return new Error(`${message}\n\n${details}`);
}

function missingSSHBinaryError(logs: RecentLogs): Error {
  return readinessFailure(
    'SSH client is unavailable. Install OpenSSH and ensure `ssh` is on PATH before using SSH Environments.',
    logs,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRuntimeReleaseTag(raw: string): string {
  const clean = compact(raw);
  if (clean === '') {
    throw new Error('Redeven runtime release tag is required for SSH bootstrap.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function bindRecentLog(
  stream: Readable | null,
  key: keyof MutableRecentLogs,
  logs: MutableRecentLogs,
  onLog: StartManagedSSHRuntimeArgs['onLog'],
): void {
  if (!stream) {
    return;
  }
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    logs[key] = appendRecentLog(logs[key], chunk);
    onLog?.(key, chunk);
  });
}

function sshTargetArgs(target: DesktopSSHEnvironmentDetails): string[] {
  const args: string[] = [];
  if (target.ssh_port !== null) {
    args.push('-p', String(target.ssh_port));
  }
  args.push(target.ssh_destination);
  return args;
}

function sshSharedArgs(controlSocketPath: string, connectTimeoutSeconds: number): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-S', controlSocketPath,
  ];
}

function buildRemoteInstallRootShell(): string {
  return [
    'install_root_raw="$1"',
    `if [ "$install_root_raw" = "${DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR}" ]; then`,
    '  install_root="${XDG_CACHE_HOME:-$HOME/.cache}/redeven-desktop/runtime"',
    'else',
    '  install_root="$install_root_raw"',
    'fi',
  ].join('\n');
}

export function buildManagedSSHControlScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'session_token="$3"',
    'install_script_url="$4"',
    'version_root="${install_root%/}/${release_tag}"',
    'bin_dir="${version_root}/bin"',
    'binary="${bin_dir}/redeven"',
    'session_dir="${version_root}/sessions/${session_token}"',
    'report_path="${session_dir}/startup-report.json"',
    'cleanup() { rm -rf "$session_dir"; }',
    'trap cleanup EXIT INT TERM',
    'mkdir -p "$session_dir"',
    'install_runtime() {',
    '  curl -fsSL "$install_script_url" | REDEVEN_INSTALL_MODE=upgrade REDEVEN_VERSION="$release_tag" REDEVEN_INSTALL_DIR="$bin_dir" sh',
    '}',
    'if [ ! -x "$binary" ]; then',
    '  install_runtime',
    'fi',
    'if ! "$binary" version >/dev/null 2>&1; then',
    '  install_runtime',
    'fi',
    'exec "$binary" run --mode local --local-ui-bind 127.0.0.1:0 --startup-report-file "$report_path"',
  ].join('\n');
}

export function buildManagedSSHReportReadScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'session_token="$3"',
    'report_path="${install_root%/}/${release_tag}/sessions/${session_token}/startup-report.json"',
    'if [ ! -f "$report_path" ]; then',
    '  exit 1',
    'fi',
    'cat "$report_path"',
  ].join('\n');
}

function remotePortFromStartup(startup: StartupReport): number {
  let parsed: URL;
  try {
    parsed = new URL(startup.local_ui_url);
  } catch {
    throw new Error('Remote Redeven startup report returned an invalid Local UI URL.');
  }
  const port = Number.parseInt(compact(parsed.port), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('Remote Redeven startup report did not include a usable Local UI port.');
  }
  return port;
}

function localForwardURL(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

async function waitForForwardedLocalUI(url: string, timeoutMs: number): Promise<StartupReport | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const startup = await loadExternalLocalUIStartup(url, Math.min(timeoutMs, DEFAULT_SSH_POLL_INTERVAL_MS));
    if (startup) {
      return startup;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

async function allocateLocalForwardPort(): Promise<number> {
  const server = net.createServer();
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string' || !Number.isInteger(address.port) || address.port <= 0) {
        server.close();
        reject(new Error('Desktop failed to allocate a local SSH forward port.'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function stopChildProcess(child: SpawnedSSHProcess | null, timeoutMs: number): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill('SIGTERM');
  const exitPromise = once(child, 'exit').then(() => undefined);
  const timeoutPromise = delay(timeoutMs).then(() => 'timeout' as const);
  const result = await Promise.race([exitPromise, timeoutPromise]);
  if (result === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await exitPromise;
  }
}

async function runSSHOnce(
  sshBinary: string,
  args: readonly string[],
  logs: MutableRecentLogs,
  key: keyof MutableRecentLogs,
  onLog: StartManagedSSHRuntimeArgs['onLog'],
): Promise<SSHCommandResult> {
  return new Promise<SSHCommandResult>((resolve, reject) => {
    const child = spawn(sshBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let spawnError: Error | null = null;

    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
    });

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }
    bindRecentLog(child.stderr, key, logs, onLog);
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.once('close', (exitCode, signal) => {
      if (spawnError) {
        const nodeError = spawnError as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          reject(missingSSHBinaryError(logs));
          return;
        }
        reject(spawnError);
        return;
      }
      resolve({
        exit_code: exitCode,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

async function waitForMasterReady(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  startupTimeoutMs: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  getMasterProcess: () => SpawnedSSHProcess | null;
}>): Promise<void> {
  const deadline = Date.now() + args.startupTimeoutMs;
  for (;;) {
    const masterProcess = args.getMasterProcess();
    if (!masterProcess) {
      throw readinessFailure('Desktop failed to start the SSH control connection.', args.logs);
    }
    if (masterProcess.exitCode !== null || masterProcess.signalCode) {
      throw readinessFailure('Desktop could not establish the SSH control connection.', args.logs);
    }

    const result = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
        '-O', 'check',
        ...sshTargetArgs(args.target),
      ],
      args.logs,
      'master_stderr',
      args.onLog,
    );
    if (result.exit_code === 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw readinessFailure('Timed out waiting for the SSH control connection to become ready.', args.logs);
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

async function waitForRemoteStartupReport(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  runtimeReleaseTag: string;
  sessionToken: string;
  startupTimeoutMs: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  getControlProcess: () => SpawnedSSHProcess | null;
}>): Promise<StartupReport> {
  const deadline = Date.now() + args.startupTimeoutMs;
  const script = buildManagedSSHReportReadScript();
  for (;;) {
    const controlProcess = args.getControlProcess();
    if (!controlProcess) {
      throw readinessFailure('Desktop lost the SSH runtime bootstrap session before Redeven reported readiness.', args.logs);
    }
    if (controlProcess.exitCode !== null || controlProcess.signalCode) {
      throw readinessFailure('Remote Redeven stopped before reporting readiness.', args.logs);
    }

    const result = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
        ...sshTargetArgs(args.target),
        'sh', '-lc', script, 'redeven-ssh-read-report',
        args.target.remote_install_dir,
        args.runtimeReleaseTag,
        args.sessionToken,
      ],
      args.logs,
      'control_stderr',
      args.onLog,
    );
    if (result.exit_code === 0) {
      try {
        return parseStartupReport(result.stdout);
      } catch (error) {
        throw readinessFailure(
          error instanceof Error ? error.message : 'Remote Redeven startup report was invalid.',
          args.logs,
        );
      }
    }

    if (Date.now() >= deadline) {
      throw readinessFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.logs);
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

export async function startManagedSSHRuntime(args: StartManagedSSHRuntimeArgs): Promise<ManagedSSHRuntime> {
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const sshBinary = compact(args.sshBinary) || 'ssh';
  const installScriptURL = compact(args.installScriptURL) || PUBLIC_INSTALL_SCRIPT_URL;
  const tempRoot = compact(args.tempRoot) || os.tmpdir();
  const startupTimeoutMs = args.startupTimeoutMs ?? DEFAULT_SSH_STARTUP_TIMEOUT_MS;
  const stopTimeoutMs = args.stopTimeoutMs ?? DEFAULT_SSH_STOP_TIMEOUT_MS;
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const logs: MutableRecentLogs = {
    master_stderr: '',
    control_stdout: '',
    control_stderr: '',
    forward_stderr: '',
  };

  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-'));
  const controlSocketPath = path.join(tempDir, 'm.sock');
  const sessionToken = randomBytes(8).toString('hex');

  const masterProcess = spawn(sshBinary, [
    ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds),
    '-M',
    '-N',
    '-o', 'ControlMaster=yes',
    '-o', 'ControlPersist=no',
    ...sshTargetArgs(target),
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let masterSpawnError: Error | null = null;
  masterProcess.once('error', (error) => {
    masterSpawnError = error instanceof Error ? error : new Error(String(error));
  });
  bindRecentLog(masterProcess.stderr, 'master_stderr', logs, args.onLog);

  let controlProcess: SpawnedSSHProcess | null = null;
  let forwardProcess: SpawnedSSHProcess | null = null;

  const cleanup = async () => {
    await stopChildProcess(forwardProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(controlProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(masterProcess, stopTimeoutMs).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    if (masterSpawnError) {
      throw masterSpawnError;
    }
    await waitForMasterReady({
      sshBinary,
      target,
      controlSocketPath,
      connectTimeoutSeconds,
      startupTimeoutMs,
      logs,
      onLog: args.onLog,
      getMasterProcess: () => masterProcess,
    });

    const controlScript = buildManagedSSHControlScript();
    controlProcess = spawn(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds),
      ...sshTargetArgs(target),
      'sh', '-lc', controlScript, 'redeven-ssh-start',
      target.remote_install_dir,
      runtimeReleaseTag,
      sessionToken,
      installScriptURL,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let controlSpawnError: Error | null = null;
    controlProcess.once('error', (error) => {
      controlSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(controlProcess.stdout, 'control_stdout', logs, args.onLog);
    bindRecentLog(controlProcess.stderr, 'control_stderr', logs, args.onLog);
    if (controlSpawnError) {
      throw controlSpawnError;
    }

    const remoteStartup = await waitForRemoteStartupReport({
      sshBinary,
      target,
      controlSocketPath,
      connectTimeoutSeconds,
      runtimeReleaseTag,
      sessionToken,
      startupTimeoutMs,
      logs,
      onLog: args.onLog,
      getControlProcess: () => controlProcess,
    });

    const localPort = await allocateLocalForwardPort();
    const remotePort = remotePortFromStartup(remoteStartup);
    forwardProcess = spawn(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds),
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      ...sshTargetArgs(target),
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let forwardSpawnError: Error | null = null;
    forwardProcess.once('error', (error) => {
      forwardSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(forwardProcess.stderr, 'forward_stderr', logs, args.onLog);
    if (forwardSpawnError) {
      throw forwardSpawnError;
    }

    const forwardedURL = localForwardURL(localPort);
    const forwardedStartup = await waitForForwardedLocalUI(
      forwardedURL,
      args.probeTimeoutMs ?? startupTimeoutMs,
    );
    if (!forwardedStartup) {
      throw readinessFailure('Desktop created the SSH port forward but could not reach the forwarded Redeven Local UI.', logs);
    }

    const startup: StartupReport = {
      ...remoteStartup,
      local_ui_url: forwardedStartup.local_ui_url,
      local_ui_urls: forwardedStartup.local_ui_urls,
      password_required: forwardedStartup.password_required,
    };
    const stop = async () => {
      await cleanup();
    };
    return {
      startup,
      local_forward_url: forwardedURL,
      runtime_handle: {
        owner_kind: 'ssh_runtime',
        restartable: false,
        stop,
      },
      stop,
    };
  } catch (error) {
    await cleanup();
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      throw missingSSHBinaryError(logs);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw readinessFailure(String(error), logs);
  }
}
