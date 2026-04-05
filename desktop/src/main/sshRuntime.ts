import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  ensureDesktopSSHReleaseAsset,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
  type DesktopSSHReleaseFetchPolicy,
} from './sshReleaseAssets';
import { loadExternalLocalUIStartup } from './runtimeState';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import { parseStartupReport, type StartupReport } from './startup';
import {
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';

const PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';
const DEFAULT_SSH_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_SSH_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_SSH_POLL_INTERVAL_MS = 200;
const MAX_RECENT_LOG_CHARS = 8_000;

type SpawnedSSHProcess = ChildProcessByStdio<Writable | null, Readable | null, Readable>;
type RemoteInstallStrategy = 'desktop_upload' | 'remote_install';
type PreparedDesktopSSHUploadAsset = Readonly<{
  archiveData: Buffer;
}>;

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

class DesktopSSHUploadAssetPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesktopSSHUploadAssetPreparationError';
  }
}

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
  assetCacheRoot?: string;
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

export function buildManagedSSHRuntimeReadyScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'binary="${install_root%/}/${release_tag}/bin/redeven"',
    'if [ ! -x "$binary" ]; then',
    '  exit 1',
    'fi',
    '"$binary" version >/dev/null 2>&1',
  ].join('\n');
}

export function buildManagedSSHRemoteInstallScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'install_script_url="$3"',
    'version_root="${install_root%/}/${release_tag}"',
    'bin_dir="${version_root}/bin"',
    'binary="${bin_dir}/redeven"',
    'install_runtime() {',
    '  curl -fsSL "$install_script_url" | REDEVEN_INSTALL_MODE=upgrade REDEVEN_VERSION="$release_tag" REDEVEN_INSTALL_DIR="$bin_dir" sh',
    '}',
    'if [ ! -x "$binary" ]; then',
    '  install_runtime',
    'fi',
    'if ! "$binary" version >/dev/null 2>&1; then',
    '  install_runtime',
    'fi',
  ].join('\n');
}

export function buildManagedSSHUploadedInstallScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'archive_path="$3"',
    'upload_dir="$4"',
    'version_root="${install_root%/}/${release_tag}"',
    'bin_dir="${version_root}/bin"',
    'extract_dir="$(mktemp -d "${upload_dir%/}/extract.XXXXXX")"',
    'cleanup() { rm -rf "$extract_dir" "$upload_dir"; }',
    'trap cleanup EXIT INT TERM',
    'mkdir -p "$bin_dir"',
    'if tar --warning=no-unknown-keyword -xzf "$archive_path" -C "$extract_dir" 2>/dev/null; then',
    '  :',
    'elif tar -xzf "$archive_path" -C "$extract_dir"; then',
    '  :',
    'else',
    '  echo "failed to extract uploaded Redeven archive" >&2',
    '  exit 1',
    'fi',
    'binary_path="${extract_dir}/redeven"',
    'if [ ! -f "$binary_path" ]; then',
    '  echo "uploaded Redeven archive did not contain redeven" >&2',
    '  exit 1',
    'fi',
    'mv "$binary_path" "${bin_dir}/redeven"',
    'chmod +x "${bin_dir}/redeven"',
  ].join('\n');
}

export function buildManagedSSHStartScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'release_tag="$2"',
    'session_token="$3"',
    'version_root="${install_root%/}/${release_tag}"',
    'bin_dir="${version_root}/bin"',
    'binary="${bin_dir}/redeven"',
    'session_dir="${version_root}/sessions/${session_token}"',
    'report_path="${session_dir}/startup-report.json"',
    'cleanup() { rm -rf "$session_dir"; }',
    'trap cleanup EXIT INT TERM',
    'mkdir -p "$session_dir"',
    'if [ ! -x "$binary" ]; then',
    '  echo "Redeven runtime is not installed at ${binary}" >&2',
    '  exit 1',
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
  stdinData?: Buffer,
): Promise<SSHCommandResult> {
  return new Promise<SSHCommandResult>((resolve, reject) => {
    const child = spawn(sshBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let spawnError: Error | null = null;

    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
    });

    if (stdinData) {
      child.stdin?.end(stdinData);
    } else {
      child.stdin?.end();
    }

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

async function remoteRuntimeIsInstalled(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  runtimeReleaseTag: string;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<boolean> {
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
      ...sshTargetArgs(args.target),
      'sh', '-lc', buildManagedSSHRuntimeReadyScript(), 'redeven-ssh-runtime-ready',
      args.target.remote_install_dir,
      args.runtimeReleaseTag,
    ],
    args.logs,
    'control_stderr',
    args.onLog,
  );
  return result.exit_code === 0;
}

async function probeRemotePlatform(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<DesktopSSHRemotePlatform> {
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
      ...sshTargetArgs(args.target),
      'sh', '-lc', 'set -eu\nuname -s\nuname -m',
    ],
    args.logs,
    'control_stderr',
    args.onLog,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not determine the remote platform for SSH bootstrap.', args.logs);
  }
  const lines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) {
    throw readinessFailure('Desktop received an incomplete remote platform probe result over SSH.', args.logs);
  }
  return resolveDesktopSSHRemotePlatform(lines[0], lines[1]);
}

async function createRemoteTempDir(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<string> {
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
      ...sshTargetArgs(args.target),
      'sh', '-lc', 'set -eu\numask 077\nmktemp -d "${TMPDIR:-/tmp}/redeven-ssh-upload.XXXXXX"',
    ],
    args.logs,
    'control_stderr',
    args.onLog,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not allocate a remote temporary directory for SSH upload.', args.logs);
  }
  const remoteDir = compact(result.stdout);
  if (remoteDir === '') {
    throw readinessFailure('Desktop received an empty remote upload directory from SSH bootstrap.', args.logs);
  }
  return remoteDir;
}

async function removeRemotePath(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  remotePath: string;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<void> {
  if (compact(args.remotePath) === '') {
    return;
  }
  await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
      ...sshTargetArgs(args.target),
      'sh', '-lc', 'set -eu\nrm -rf "$1"', 'redeven-ssh-cleanup-path',
      args.remotePath,
    ],
    args.logs,
    'control_stderr',
    args.onLog,
  ).catch(() => undefined);
}

function installStrategyOrder(strategy: DesktopSSHBootstrapStrategy): readonly RemoteInstallStrategy[] {
  switch (strategy) {
    case 'desktop_upload':
      return ['desktop_upload'];
    case 'remote_install':
      return ['remote_install'];
    default:
      return ['desktop_upload', 'remote_install'];
  }
}

function resolveDesktopSSHReleaseFetchPolicy(startupTimeoutMs: number, connectTimeoutSeconds: number): DesktopSSHReleaseFetchPolicy {
  return {
    timeout_ms: Math.max(
      1,
      Math.floor(Math.min(startupTimeoutMs, Math.max(DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS, connectTimeoutSeconds * 1_000))),
    ),
  };
}

async function installRemoteRuntimeViaRemoteInstall(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  runtimeReleaseTag: string;
  installScriptURL: string;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<void> {
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
      ...sshTargetArgs(args.target),
      'sh', '-lc', buildManagedSSHRemoteInstallScript(), 'redeven-ssh-remote-install',
      args.target.remote_install_dir,
      args.runtimeReleaseTag,
      args.installScriptURL,
    ],
    args.logs,
    'control_stderr',
    args.onLog,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not install Redeven on the remote host using the remote installer.', args.logs);
  }
}

async function prepareDesktopSSHUploadAsset(args: Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  assetCacheRoot: string;
  platform: DesktopSSHRemotePlatform;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
}>): Promise<PreparedDesktopSSHUploadAsset> {
  try {
    const asset = await ensureDesktopSSHReleaseAsset({
      releaseTag: args.runtimeReleaseTag,
      releaseBaseURL: args.target.release_base_url,
      platform: args.platform,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy: args.fetchPolicy,
    });
    return {
      archiveData: await fs.readFile(asset.archive_path),
    };
  } catch (error) {
    throw new DesktopSSHUploadAssetPreparationError(
      `Desktop could not prepare the ${args.platform.platform_label} Redeven release archive locally: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function installRemoteRuntimeViaDesktopUpload(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  runtimeReleaseTag: string;
  platform: DesktopSSHRemotePlatform;
  archiveData: Buffer;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<void> {
  const remoteTempDir = await createRemoteTempDir(args);
  const remoteArchivePath = `${remoteTempDir}/redeven.tar.gz`;

  try {
    const uploadResult = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
        ...sshTargetArgs(args.target),
        'sh', '-lc', 'set -eu\ncat > "$1"', 'redeven-ssh-upload-archive',
        remoteArchivePath,
      ],
      args.logs,
      'control_stderr',
      args.onLog,
      args.archiveData,
    );
    if (uploadResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not upload the ${args.platform.release_package_name} release archive over SSH.`,
        args.logs,
      );
    }

    const installResult = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds),
        ...sshTargetArgs(args.target),
        'sh', '-lc', buildManagedSSHUploadedInstallScript(), 'redeven-ssh-upload-install',
        args.target.remote_install_dir,
        args.runtimeReleaseTag,
        remoteArchivePath,
        remoteTempDir,
      ],
      args.logs,
      'control_stderr',
      args.onLog,
    );
    if (installResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not install the uploaded ${args.platform.platform_label} Redeven package on the remote host.`,
        args.logs,
      );
    }
  } finally {
    await removeRemotePath({
      ...args,
      remotePath: remoteTempDir,
    });
  }
}

async function ensureRemoteRuntimeInstalled(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  runtimeReleaseTag: string;
  installScriptURL: string;
  assetCacheRoot: string;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
}>): Promise<void> {
  if (await remoteRuntimeIsInstalled(args)) {
    return;
  }

  const failures: string[] = [];
  for (const strategy of installStrategyOrder(args.target.bootstrap_strategy)) {
    try {
      if (strategy === 'desktop_upload') {
        const platform = await probeRemotePlatform(args);
        let preparedUpload: PreparedDesktopSSHUploadAsset;
        try {
          preparedUpload = await prepareDesktopSSHUploadAsset({
            target: args.target,
            runtimeReleaseTag: args.runtimeReleaseTag,
            assetCacheRoot: args.assetCacheRoot,
            platform,
            fetchPolicy: args.fetchPolicy,
          });
        } catch (error) {
          if (args.target.bootstrap_strategy === 'auto' && error instanceof DesktopSSHUploadAssetPreparationError) {
            failures.push(`${strategy}: ${error.message}`);
            continue;
          }
          throw error;
        }
        await installRemoteRuntimeViaDesktopUpload({
          sshBinary: args.sshBinary,
          target: args.target,
          controlSocketPath: args.controlSocketPath,
          connectTimeoutSeconds: args.connectTimeoutSeconds,
          runtimeReleaseTag: args.runtimeReleaseTag,
          platform,
          archiveData: preparedUpload.archiveData,
          logs: args.logs,
          onLog: args.onLog,
        });
      } else {
        await installRemoteRuntimeViaRemoteInstall(args);
      }
      if (await remoteRuntimeIsInstalled(args)) {
        return;
      }
      failures.push(`${strategy}: remote runtime remained unavailable after installation.`);
    } catch (error) {
      failures.push(`${strategy}: ${error instanceof Error ? error.message : String(error)}`);
      if (strategy === 'desktop_upload' && args.target.bootstrap_strategy === 'auto') {
        break;
      }
    }
  }

  const attempts = failures.map((failure) => `- ${failure}`).join('\n');
  throw readinessFailure(
    `Desktop could not install the remote Redeven runtime over SSH.\n\nAttempts:\n${attempts}`,
    args.logs,
  );
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
  const assetCacheRoot = compact(args.assetCacheRoot) || path.join(tempRoot, 'redeven-ssh-release-cache');
  const startupTimeoutMs = args.startupTimeoutMs ?? DEFAULT_SSH_STARTUP_TIMEOUT_MS;
  const stopTimeoutMs = args.stopTimeoutMs ?? DEFAULT_SSH_STOP_TIMEOUT_MS;
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const releaseFetchPolicy = resolveDesktopSSHReleaseFetchPolicy(startupTimeoutMs, connectTimeoutSeconds);
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

    await ensureRemoteRuntimeInstalled({
      sshBinary,
      target,
      controlSocketPath,
      connectTimeoutSeconds,
      runtimeReleaseTag,
      installScriptURL,
      assetCacheRoot,
      fetchPolicy: releaseFetchPolicy,
      logs,
      onLog: args.onLog,
    });

    controlProcess = spawn(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds),
      ...sshTargetArgs(target),
      'sh', '-lc', buildManagedSSHStartScript(), 'redeven-ssh-start',
      target.remote_install_dir,
      runtimeReleaseTag,
      sessionToken,
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
