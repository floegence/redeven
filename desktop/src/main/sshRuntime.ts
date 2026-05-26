import { spawn, type ChildProcessByStdio, type SpawnOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
  type DesktopSSHReleaseFetchPolicy,
} from './sshReleaseAssets';
import {
  prepareDesktopRuntimeUploadAsset,
  type DesktopRuntimeUploadAsset,
} from './runtimePackageCache';
import { loadExternalLocalUIStartup } from './runtimeState';
import type { DesktopSessionRuntimeHandle, DesktopSessionRuntimeLaunchMode } from './sessionRuntime';
import type { StartupReport } from './startup';
import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import { formatBlockedLaunchDiagnostics, parseLaunchReport, type LaunchBlockedReport } from './launchReport';
import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  diagnosticsFromRecentLogs,
} from './desktopOperationFailure';
import {
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHAuthMode,
  type DesktopSSHBootstrapStrategy,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  formatRuntimeServiceWorkload,
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceSupportsDesktopModelSource,
  type RuntimeServiceIdentity,
} from '../shared/runtimeService';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';

const PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';
const DEFAULT_SSH_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_SSH_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_SSH_POLL_INTERVAL_MS = 200;
const MAX_RECENT_LOG_CHARS = 8_000;
export const MANAGED_SSH_RUNTIME_STAMP_FILENAME = 'managed-runtime.stamp';
export const MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION = 1;

type SpawnedSSHProcess = ChildProcessByStdio<Writable | null, Readable | null, Readable>;
type RemoteInstallStrategy = 'desktop_upload' | 'remote_install';
type PreparedDesktopSSHUploadAsset = DesktopRuntimeUploadAsset;
type SSHCommandAuthContext = Readonly<{
  mode: DesktopSSHAuthMode;
  askPassScriptPath?: string;
  password?: string;
}>;

export type DesktopSSHRuntimeStatusProbe = Readonly<
  | {
      status: 'ready';
      startup: StartupReport;
    }
  | {
      status: 'blocked';
      report: LaunchBlockedReport;
    }
  | {
      status: 'not_running';
      message: string;
    }
  | {
      status: 'failed';
      message: string;
      failure: DesktopOperationFailurePresentation;
    }
>;
export type StopManagedSSHRuntimeProcessArgs = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  pid: number;
  sshPassword?: string;
  sshBinary?: string;
  tempRoot?: string;
  connectTimeoutSeconds?: number;
  signal?: AbortSignal;
  onLog?: StartManagedSSHRuntimeArgs['onLog'];
}>;
export type DesktopSSHRemoteRuntimeStamp = Readonly<{
  schema_version: typeof MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION;
  managed_by: 'redeven-desktop';
  runtime_release_tag: string;
  install_strategy: RemoteInstallStrategy;
}>;
export type DesktopSSHRemoteRuntimeProbeStatus =
  | 'ready'
  | 'missing_binary'
  | 'binary_not_executable'
  | 'version_command_failed'
  | 'version_output_invalid'
  | 'version_mismatch'
  | 'stamp_missing'
  | 'stamp_invalid';
export type DesktopSSHRemoteRuntimeProbeResult = Readonly<{
  status: DesktopSSHRemoteRuntimeProbeStatus;
  expected_release_tag: string;
  reported_release_tag: string | null;
  binary_path: string;
  stamp_path: string;
  reason: string;
}>;
export type DesktopSSHRuntimeProgressPhase =
  | 'ssh_connecting'
  | 'ssh_control_ready'
  | 'ssh_checking_runtime'
  | 'ssh_runtime_ready'
  | 'ssh_detecting_platform'
  | 'ssh_preparing_upload'
  | 'ssh_remote_installing'
  | 'ssh_creating_upload_dir'
  | 'ssh_uploading_archive'
  | 'ssh_installing_upload'
  | 'ssh_starting_runtime'
  | 'ssh_waiting_report'
  | 'ssh_opening_tunnel'
  | 'ssh_connecting_model_source'
  | 'ssh_verifying_tunnel'
  | 'ssh_cleaning_startup_resources';
export type DesktopSSHRuntimeProgress = Readonly<{
  phase: DesktopSSHRuntimeProgressPhase;
  title: string;
  detail: string;
}>;

type RecentLogs = Readonly<{
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
  forward_stderr: string;
  runtime_control_forward_stderr: string;
}>;

type MutableRecentLogs = {
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
  forward_stderr: string;
  runtime_control_forward_stderr: string;
};

type SSHCommandResult = Readonly<{
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

class DesktopSSHUploadAssetPreparationError extends DesktopOperationFailureError {
  constructor(
    failure: string | DesktopOperationFailurePresentation,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    const presentation = typeof failure === 'string'
      ? desktopOperationFailurePresentation({
          code: 'ssh_runtime_launch_failed',
          title: 'Runtime package preparation failed',
          summary: failure,
        })
      : failure;
    super(presentation, {
      cause: options.cause,
      runtimeLifecycleStepID: 'preparing_runtime_package',
    });
    this.name = 'DesktopSSHUploadAssetPreparationError';
  }
}

export class DesktopSSHRuntimeCanceledError extends Error {
  constructor(message = 'SSH runtime startup was canceled.') {
    super(message);
    this.name = 'DesktopSSHRuntimeCanceledError';
  }
}

export class DesktopSSHRuntimeMaintenanceRequiredError extends Error {
  readonly maintenance: DesktopRuntimeMaintenanceRequirement;
  readonly details: string;

  constructor(message: string, maintenance: DesktopRuntimeMaintenanceRequirement, details = '') {
    super(message);
    this.name = 'DesktopSSHRuntimeMaintenanceRequiredError';
    this.maintenance = maintenance;
    this.details = details.trim();
  }
}

export class DesktopSSHRuntimeReadinessTimeoutError extends DesktopOperationFailureError {
  constructor(presentation: DesktopOperationFailurePresentation) {
    super(presentation);
    this.name = 'DesktopSSHRuntimeReadinessTimeoutError';
  }
}

export type ManagedSSHRuntime = Readonly<{
  startup: StartupReport;
  local_forward_url: string;
  runtime_control_forward_url?: string;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type ManagedSSHRuntimeReady = Readonly<{
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type ManagedSSHRuntimeConnectionInput = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  ready: ManagedSSHRuntimeReady;
  runtimeReleaseTag?: string;
  sshPassword?: string;
  requireDesktopModelSource?: boolean;
  sshBinary?: string;
  tempRoot?: string;
  stopTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  probeTimeoutMs?: number;
  signal?: AbortSignal;
  onLog?: StartManagedSSHRuntimeArgs['onLog'];
  onProgress?: StartManagedSSHRuntimeArgs['onProgress'];
}>;

type ManagedSSHRemoteStartup = Readonly<{
  startup: StartupReport;
  launch_mode: DesktopSessionRuntimeLaunchMode;
}>;

export type StartManagedSSHRuntimeArgs = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  desktopOwnerID: string;
  sshPassword?: string;
  sshBinary?: string;
  installScriptURL?: string;
  sourceRuntimeRoot?: string;
  tempRoot?: string;
  assetCacheRoot?: string;
  forceRuntimeUpdate?: boolean;
  allowActiveWorkReplacement?: boolean;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  probeTimeoutMs?: number;
  requireDesktopModelSource?: boolean;
  signal?: AbortSignal;
  onLog?: (
    stream:
      | 'master_stderr'
      | 'control_stdout'
      | 'control_stderr'
      | 'forward_stderr'
      | 'runtime_control_forward_stderr',
    chunk: string,
  ) => void;
  onProgress?: (progress: DesktopSSHRuntimeProgress) => void;
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

function formatRecentLogsForMaintenanceDetails(logs: RecentLogs): string {
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

const SSH_RECENT_LOG_LABELS: Record<keyof RecentLogs, string> = {
  master_stderr: 'SSH control connection stderr',
  control_stdout: 'SSH command stdout',
  control_stderr: 'SSH command stderr',
  forward_stderr: 'SSH local tunnel stderr',
  runtime_control_forward_stderr: 'SSH runtime-control tunnel stderr',
};

function readinessFailure(
  message: string,
  logs: RecentLogs,
  options: Readonly<{
    code?: DesktopOperationFailurePresentation['code'];
    title?: string;
    summary?: string;
    detail?: string;
    recoveryHint?: string;
    targetLabel?: string;
  }> = {},
): Error {
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: options.code ?? 'ssh_runtime_launch_failed',
    title: options.title ?? 'SSH Runtime Start Failed',
    summary: compact(options.summary) || message,
    detail: options.detail,
    recoveryHint: options.recoveryHint,
    targetLabel: options.targetLabel,
    diagnostics: diagnosticsFromRecentLogs(logs, SSH_RECENT_LOG_LABELS),
  }));
}

function readinessTimeoutFailure(
  message: string,
  logs: RecentLogs,
  options: Readonly<{
    title: string;
    detail: string;
    targetLabel: string;
  }>,
): Error {
  return new DesktopSSHRuntimeReadinessTimeoutError(desktopOperationFailurePresentation({
    code: 'ssh_runtime_launch_failed',
    title: options.title,
    summary: message,
    detail: options.detail,
    targetLabel: options.targetLabel,
    diagnostics: diagnosticsFromRecentLogs(logs, SSH_RECENT_LOG_LABELS),
  }));
}

function missingSSHBinaryError(logs: RecentLogs): Error {
  return readinessFailure(
    'SSH client is unavailable. Install OpenSSH and ensure `ssh` is on PATH before using SSH Environments.',
    logs,
    {
      code: 'ssh_connection_failed',
      title: 'SSH Client Unavailable',
      recoveryHint: 'Install OpenSSH and ensure the ssh executable is available on PATH.',
    },
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  const candidate = error as Partial<Error> & Readonly<{ code?: string }>;
  return candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR';
}

function throwIfSSHRuntimeCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DesktopSSHRuntimeCanceledError();
  }
}

function emitSSHRuntimeProgress(
  onProgress: StartManagedSSHRuntimeArgs['onProgress'],
  phase: DesktopSSHRuntimeProgressPhase,
  title: string,
  detail: string,
): void {
  onProgress?.({
    phase,
    title,
    detail,
  });
}

function normalizeRuntimeReleaseTag(raw: string): string {
  const clean = compact(raw);
  if (clean === '') {
    throw new Error(
      'Desktop could not resolve the SSH runtime release tag for SSH bootstrap. Set REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG when running Desktop from source.',
    );
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

function shellQuote(value: string): string {
  if (value === '') {
    return "''";
  }
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function remoteShellCommand(script: string, marker: string, scriptArgs: readonly string[] = []): string {
  return [
    'sh',
    '-c',
    shellQuote(script),
    shellQuote(marker),
    ...scriptArgs.map(shellQuote),
  ].join(' ');
}

function sshSharedArgs(controlSocketPath: string, connectTimeoutSeconds: number, authMode: DesktopSSHAuthMode): string[] {
  const args = [
    '-T',
    '-x',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o', 'RequestTTY=no',
    '-o', 'ForwardX11=no',
    '-o', 'ForwardX11Trusted=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-S', controlSocketPath,
  ];
  if (authMode === 'key_agent') {
    args.unshift('-o', 'BatchMode=yes');
  } else {
    args.unshift('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=3');
  }
  return args;
}

function sshStandaloneArgs(connectTimeoutSeconds: number, authMode: DesktopSSHAuthMode): string[] {
  const args = [
    '-T',
    '-x',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o', 'RequestTTY=no',
    '-o', 'ForwardX11=no',
    '-o', 'ForwardX11Trusted=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=1',
  ];
  if (authMode === 'key_agent') {
    args.unshift('-o', 'BatchMode=yes');
  } else {
    args.unshift('-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=1');
  }
  return args;
}

function sshSpawnOptions(auth: SSHCommandAuthContext): SpawnOptions {
  if (auth.mode !== 'password' || !auth.askPassScriptPath) {
    return {};
  }
  const password = compact(auth.password);
  return {
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0',
      SSH_ASKPASS: auth.askPassScriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
      ...(password !== '' ? { REDEVEN_DESKTOP_SSH_PASSWORD: password } : {}),
    },
  };
}

function shouldPipeSSHStdin(auth: SSHCommandAuthContext, stdinData?: Buffer): boolean {
  return Boolean(stdinData) || auth.mode !== 'password';
}

function sshStdioForAuth(auth: SSHCommandAuthContext, stdinData?: Buffer): ['pipe' | 'ignore', 'pipe', 'pipe'] {
  return [
    shouldPipeSSHStdin(auth, stdinData) ? 'pipe' : 'ignore',
    'pipe',
    'pipe',
  ];
}

function spawnSSHProcess(
  sshBinary: string,
  args: readonly string[],
  auth: SSHCommandAuthContext,
  stdinData?: Buffer,
  signal?: AbortSignal,
): SpawnedSSHProcess {
  throwIfSSHRuntimeCanceled(signal);
  return spawn(sshBinary, args, {
    ...sshSpawnOptions(auth),
    stdio: sshStdioForAuth(auth, stdinData),
    signal,
  }) as SpawnedSSHProcess;
}

function buildRemoteInstallRootShell(): string {
  return [
    'runtime_root_raw="$1"',
    `if [ "$runtime_root_raw" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "remote HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    '  runtime_root="${HOME%/}/.redeven"',
    'else',
    '  runtime_root="$runtime_root_raw"',
    'fi',
  ].join('\n');
}

function buildManagedSSHRuntimePathShell(): string {
  return [
    'release_tag="$2"',
    'release_root="${runtime_root%/}/runtime/releases/${release_tag}"',
    'bin_dir="${release_root}/bin"',
    'binary="${bin_dir}/redeven"',
    `stamp_path="\${release_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
  ].join('\n');
}

function buildManagedSSHRuntimeProbeShell(): string {
  return [
    'probe_status=""',
    'probe_reason=""',
    'reported_release_tag=""',
    'read_install_strategy_line() {',
    '  install_strategy_line=""',
    '  while IFS= read -r stamp_line; do',
    '    case "$stamp_line" in',
    '      install_strategy=*)',
    '        install_strategy_line="$stamp_line"',
    '        break',
    '        ;;',
    '    esac',
    '  done < "$stamp_path"',
    '}',
    'runtime_is_compatible() {',
    '  if [ ! -e "$binary" ]; then',
    '    probe_status="missing_binary"',
    '    probe_reason="managed runtime binary is missing"',
    '    return 1',
    '  fi',
    '  if [ ! -x "$binary" ]; then',
    '    probe_status="binary_not_executable"',
    '    probe_reason="managed runtime binary is not executable"',
    '    return 1',
    '  fi',
    '  if ! version_output="$("$binary" version 2>/dev/null)"; then',
    '    probe_status="version_command_failed"',
    '    probe_reason="managed runtime failed to report its version"',
    '    return 1',
    '  fi',
    '  set -- $version_output',
    '  if [ "${1:-}" != "redeven" ] || [ -z "${2:-}" ]; then',
    '    probe_status="version_output_invalid"',
    '    probe_reason="managed runtime returned an invalid version string"',
    '    return 1',
    '  fi',
    '  reported_release_tag="$2"',
    '  case "$reported_release_tag" in',
    '    v*) ;;',
    '    *) reported_release_tag="v$reported_release_tag" ;;',
    '  esac',
    '  if [ "$reported_release_tag" != "$release_tag" ]; then',
    '    probe_status="version_mismatch"',
    '    probe_reason="managed runtime version does not match the requested Desktop release"',
    '    return 1',
    '  fi',
    '  if [ ! -f "$stamp_path" ]; then',
    '    probe_status="stamp_missing"',
    '    probe_reason="managed runtime stamp is missing"',
    '    return 1',
    '  fi',
    `  if ! grep -Fx "schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}" "$stamp_path" >/dev/null 2>&1; then`,
    '    probe_status="stamp_invalid"',
    '    probe_reason="managed runtime stamp schema is invalid"',
    '    return 1',
    '  fi',
    '  if ! grep -Fx "managed_by=redeven-desktop" "$stamp_path" >/dev/null 2>&1; then',
    '    probe_status="stamp_invalid"',
    '    probe_reason="managed runtime stamp owner is invalid"',
    '    return 1',
    '  fi',
    '  if ! grep -Fx "runtime_release_tag=$release_tag" "$stamp_path" >/dev/null 2>&1; then',
    '    probe_status="stamp_invalid"',
    '    probe_reason="managed runtime stamp release does not match the requested Desktop release"',
    '    return 1',
    '  fi',
    '  read_install_strategy_line',
    '  case "$install_strategy_line" in',
    '    install_strategy=desktop_upload|install_strategy=remote_install)',
    '      ;;',
    '    *)',
    '      probe_status="stamp_invalid"',
    '      probe_reason="managed runtime stamp install strategy is invalid"',
    '      return 1',
    '      ;;',
    '  esac',
    '  probe_status="ready"',
    '  probe_reason="desktop-managed runtime is compatible"',
    '  return 0',
    '}',
  ].join('\n');
}

function buildManagedSSHRuntimeStampShell(): string {
  return [
    'write_runtime_stamp() {',
    '  install_strategy="$1"',
    '  mkdir -p "$release_root"',
    '  temp_stamp="${stamp_path}.tmp.$$"',
    '  {',
    `    printf 'schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}\\n'`,
    "    printf 'managed_by=redeven-desktop\\n'",
    "    printf 'runtime_release_tag=%s\\n' \"$release_tag\"",
    "    printf 'install_strategy=%s\\n' \"$install_strategy\"",
    '  } > "$temp_stamp"',
    '  mv "$temp_stamp" "$stamp_path"',
    '}',
  ].join('\n');
}

export function buildManagedSSHRuntimeProbeScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    buildManagedSSHRuntimeProbeShell(),
    'runtime_is_compatible || true',
    "printf 'status=%s\\n' \"$probe_status\"",
    "printf 'expected_release_tag=%s\\n' \"$release_tag\"",
    "printf 'reported_release_tag=%s\\n' \"$reported_release_tag\"",
    "printf 'binary_path=%s\\n' \"$binary\"",
    "printf 'stamp_path=%s\\n' \"$stamp_path\"",
    "printf 'reason=%s\\n' \"$probe_reason\"",
  ].join('\n');
}

export function buildManagedSSHRemoteInstallScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    'install_script_url="$3"',
    'force_install="${4:-0}"',
    buildManagedSSHRuntimeProbeShell(),
    buildManagedSSHRuntimeStampShell(),
    'install_runtime() {',
    '  script_path="${release_root}/install.sh.$$"',
    '  mkdir -p "$bin_dir"',
    '  curl -fsSL "$install_script_url" -o "$script_path"',
    '  if ! REDEVEN_INSTALL_MODE=upgrade REDEVEN_VERSION="$release_tag" REDEVEN_INSTALL_DIR="$bin_dir" sh "$script_path"; then',
    '    rm -f "$script_path"',
    '    return 1',
    '  fi',
    '  rm -f "$script_path"',
    '}',
    'if [ "$force_install" = "1" ] || ! runtime_is_compatible; then',
    '  install_runtime',
    '  write_runtime_stamp "remote_install"',
    'fi',
  ].join('\n');
}

export function buildManagedSSHUploadedInstallScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    'archive_path="$3"',
    'upload_dir="$4"',
    buildManagedSSHRuntimeStampShell(),
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
    'write_runtime_stamp "desktop_upload"',
  ].join('\n');
}

export function buildManagedSSHStartScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    'state_root="${runtime_root%/}"',
    'session_token="$3"',
    'desktop_owner_id="${4:-}"',
    'session_dir="${runtime_root%/}/runtime/sessions/${session_token}"',
    'report_path="${session_dir}/startup-report.json"',
    'log_dir="${runtime_root%/}/runtime/logs"',
    'log_path="${log_dir}/runtime-${session_token}.log"',
    'mkdir -p "$state_root" "$session_dir" "$log_dir"',
    'rm -f "$report_path"',
    'if [ ! -x "$binary" ]; then',
    '  echo "Redeven runtime is not installed at ${binary}" >&2',
    '  exit 1',
    'fi',
    'if [ -z "$desktop_owner_id" ]; then',
    '  echo "Desktop owner id is required for SSH runtime-control." >&2',
    '  exit 1',
    'fi',
    'export REDEVEN_DESKTOP_OWNER_ID="$desktop_owner_id"',
    'if command -v setsid >/dev/null 2>&1; then',
    '  setsid "$binary" run --state-root "$state_root" --mode desktop --desktop-managed --presentation machine --local-ui-bind 127.0.0.1:0 --startup-report-file "$report_path" >>"$log_path" 2>&1 </dev/null &',
    'else',
    '  nohup "$binary" run --state-root "$state_root" --mode desktop --desktop-managed --presentation machine --local-ui-bind 127.0.0.1:0 --startup-report-file "$report_path" >>"$log_path" 2>&1 </dev/null &',
    'fi',
    'printf "%s\\n" "$!" > "${session_dir}/launcher.pid"',
  ].join('\n');
}

export function buildManagedSSHReportReadScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'session_token="$2"',
    'report_path="${runtime_root%/}/runtime/sessions/${session_token}/startup-report.json"',
    'if [ ! -f "$report_path" ]; then',
    '  exit 1',
    'fi',
    'cat "$report_path"',
  ].join('\n');
}

function buildManagedSSHRuntimeStatusScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    'state_root="${runtime_root%/}"',
    'if [ ! -x "$binary" ]; then',
    '  exit 127',
    'fi',
    'exec "$binary" desktop-runtime-status --state-root "$state_root"',
  ].join('\n');
}

export async function probeManagedSSHRuntimeStatus(
  args: Readonly<{
    target: DesktopSSHEnvironmentDetails;
    runtimeReleaseTag: string;
    sshPassword?: string;
    sshBinary?: string;
    tempRoot?: string;
    connectTimeoutSeconds?: number;
    signal?: AbortSignal;
  }>,
): Promise<DesktopSSHRuntimeStatusProbe> {
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const sshBinary = compact(args.sshBinary) || 'ssh';
  const tempRoot = compact(args.tempRoot) || os.tmpdir();
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-probe-'));
  const logs: MutableRecentLogs = {
    master_stderr: '',
    control_stdout: '',
    control_stderr: '',
    forward_stderr: '',
    runtime_control_forward_stderr: '',
  };
  const auth: SSHCommandAuthContext = {
    mode: target.auth_mode,
    askPassScriptPath: await createSSHAskPassScript(tempDir, target.auth_mode),
    password: args.sshPassword,
  };
  try {
    const result = await runSSHOnce(
      sshBinary,
      [
        ...sshStandaloneArgs(connectTimeoutSeconds, auth.mode),
        ...sshTargetArgs(target),
        remoteShellCommand(buildManagedSSHRuntimeStatusScript(), 'redeven-ssh-runtime-status', [
          target.runtime_root,
          runtimeReleaseTag,
        ]),
      ],
      auth,
      logs,
      'control_stderr',
      undefined,
      undefined,
      args.signal,
    );
    if (result.exit_code !== 0) {
      const targetLabel = desktopSSHAuthority(target);
      if (result.exit_code !== 1 && result.exit_code !== 127) {
        const failure = desktopOperationFailurePresentation({
          code: 'ssh_connection_failed',
          title: 'SSH Connection Failed',
          summary: `SSH connection to "${targetLabel}" failed.`,
          detail: 'Desktop could not verify the Redeven runtime status on this SSH host.',
          recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
          targetLabel,
          diagnostics: [
            ...diagnosticsFromRecentLogs(logs, SSH_RECENT_LOG_LABELS),
            ...(compact(result.stderr) !== '' ? [{
              channel: 'ssh_stderr',
              label: 'SSH stderr',
              text: compact(result.stderr),
            }] : []),
          ],
        });
        return {
          status: 'failed',
          message: failure.summary,
          failure,
        };
      }
      return {
        status: 'not_running',
        message: 'Redeven runtime is not running on this SSH host.',
      };
    }
    const report = parseLaunchReport(result.stdout);
    if (report.status === 'blocked') {
      return {
        status: 'blocked',
        report,
      };
    }
    return {
      status: 'ready',
      startup: report.startup,
    };
  } catch (error) {
    const fallback = desktopOperationFailurePresentation({
      code: 'ssh_runtime_status_unavailable',
      title: 'SSH Runtime Status Unavailable',
      summary: 'Desktop could not verify the SSH runtime status.',
      targetLabel: desktopSSHAuthority(target),
      diagnostics: diagnosticsFromRecentLogs(logs, SSH_RECENT_LOG_LABELS),
    });
    const failure = error instanceof DesktopOperationFailureError ? error.presentation : {
      ...fallback,
      summary: error instanceof Error ? error.message : String(error),
    };
    return {
      status: 'failed',
      message: failure.summary,
      failure,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function stopManagedSSHRuntimeProcess(
  args: StopManagedSSHRuntimeProcessArgs,
): Promise<void> {
  if (!Number.isInteger(args.pid) || args.pid <= 0) {
    throw new Error('Desktop could not resolve the SSH runtime process id to stop.');
  }
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const sshBinary = compact(args.sshBinary) || 'ssh';
  const tempRoot = compact(args.tempRoot) || os.tmpdir();
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-stop-'));
  const logs: MutableRecentLogs = {
    master_stderr: '',
    control_stdout: '',
    control_stderr: '',
    forward_stderr: '',
    runtime_control_forward_stderr: '',
  };
  const auth: SSHCommandAuthContext = {
    mode: target.auth_mode,
    askPassScriptPath: await createSSHAskPassScript(tempDir, target.auth_mode),
    password: args.sshPassword,
  };
  try {
    const result = await runSSHOnce(
      sshBinary,
      [
        ...sshStandaloneArgs(connectTimeoutSeconds, auth.mode),
        ...sshTargetArgs(target),
        remoteShellCommand(buildManagedSSHStopScript(), 'redeven-ssh-stop', [
          String(args.pid),
        ]),
      ],
      auth,
      logs,
      'control_stderr',
      args.onLog,
      undefined,
      args.signal,
    );
    if (result.exit_code !== 0) {
      throw readinessFailure('Desktop could not stop the SSH runtime process.', logs, {
        code: 'ssh_runtime_stop_failed',
        title: 'SSH Runtime Stop Failed',
        summary: `Desktop could not stop the SSH runtime on "${desktopSSHAuthority(target)}".`,
        recoveryHint: 'Check whether the SSH host is reachable, then try the runtime action again.',
        targetLabel: desktopSSHAuthority(target),
      });
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function buildManagedSSHStopScript(): string {
  return [
    'set -eu',
    'pid="$1"',
    'if [ -z "$pid" ]; then',
    '  exit 0',
    'fi',
    'case "$pid" in',
    '  *[!0-9]*) exit 0 ;;',
    'esac',
    'if ! kill -0 "$pid" 2>/dev/null; then',
    '  exit 0',
    'fi',
    'kill "$pid" 2>/dev/null || true',
    'deadline=$(( $(date +%s) + 5 ))',
    'while kill -0 "$pid" 2>/dev/null; do',
    '  if [ "$(date +%s)" -ge "$deadline" ]; then',
    '    kill -KILL "$pid" 2>/dev/null || true',
    '    break',
    '  fi',
    '  sleep 0.1',
    'done',
    'deadline=$(( $(date +%s) + 5 ))',
    'while kill -0 "$pid" 2>/dev/null; do',
    '  if [ "$(date +%s)" -ge "$deadline" ]; then',
    '    echo "runtime process $pid is still running after stop" >&2',
    '    exit 1',
    '  fi',
    '  sleep 0.1',
    'done',
  ].join('\n');
}

function probeResultFallbackReason(status: DesktopSSHRemoteRuntimeProbeStatus): string {
  switch (status) {
    case 'ready':
      return 'desktop-managed runtime is compatible';
    case 'missing_binary':
      return 'managed runtime binary is missing';
    case 'binary_not_executable':
      return 'managed runtime binary is not executable';
    case 'version_command_failed':
      return 'managed runtime failed to report its version';
    case 'version_output_invalid':
      return 'managed runtime returned an invalid version string';
    case 'version_mismatch':
      return 'managed runtime version does not match the requested Desktop release';
    case 'stamp_missing':
      return 'managed runtime stamp is missing';
    case 'stamp_invalid':
      return 'managed runtime stamp is invalid';
  }
}

function normalizeProbeStatus(value: string): DesktopSSHRemoteRuntimeProbeStatus {
  const clean = compact(value);
  switch (clean) {
    case 'ready':
    case 'missing_binary':
    case 'binary_not_executable':
    case 'version_command_failed':
    case 'version_output_invalid':
    case 'version_mismatch':
    case 'stamp_missing':
    case 'stamp_invalid':
      return clean as DesktopSSHRemoteRuntimeProbeStatus;
    default:
      throw new Error(`Desktop received an unknown SSH runtime probe status: ${value}`);
  }
}

function parseProbeResultLines(raw: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of String(raw ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '') {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    values.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }
  return values;
}

export function parseManagedSSHRuntimeProbeResult(raw: string): DesktopSSHRemoteRuntimeProbeResult {
  const values = parseProbeResultLines(raw);
  const status = normalizeProbeStatus(values.get('status') ?? '');
  const expectedReleaseTag = normalizeRuntimeReleaseTag(values.get('expected_release_tag') ?? '');
  const reportedReleaseTagRaw = compact(values.get('reported_release_tag'));
  const binaryPath = compact(values.get('binary_path'));
  const stampPath = compact(values.get('stamp_path'));
  if (binaryPath === '') {
    throw new Error('Desktop SSH runtime probe did not include a binary path.');
  }
  if (stampPath === '') {
    throw new Error('Desktop SSH runtime probe did not include a stamp path.');
  }
  return {
    status,
    expected_release_tag: expectedReleaseTag,
    reported_release_tag: reportedReleaseTagRaw === '' ? null : normalizeRuntimeReleaseTag(reportedReleaseTagRaw),
    binary_path: binaryPath,
    stamp_path: stampPath,
    reason: compact(values.get('reason')) || probeResultFallbackReason(status),
  };
}

export function describeManagedSSHRuntimeProbeResult(result: DesktopSSHRemoteRuntimeProbeResult): string {
  switch (result.status) {
    case 'ready':
      return `Desktop-managed runtime at ${result.binary_path} is ready for ${result.expected_release_tag}.`;
    case 'version_mismatch':
      return `Managed runtime at ${result.binary_path} reports ${result.reported_release_tag ?? 'an unknown version'} instead of ${result.expected_release_tag}.`;
    case 'stamp_missing':
      return `Managed runtime at ${result.binary_path} matches ${result.expected_release_tag}, but the Desktop stamp is missing at ${result.stamp_path}.`;
    case 'stamp_invalid':
      return `Managed runtime stamp at ${result.stamp_path} is invalid for ${result.expected_release_tag}.`;
    default:
      return `${result.reason} (${result.binary_path}).`;
  }
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

function isLoopbackRuntimeControlHost(value: string): boolean {
  const host = compact(value).toLowerCase().replace(/^\[(.*)\]$/u, '$1');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function startupHasForwardableRuntimeControl(startup: StartupReport): boolean {
  const endpoint = startup.runtime_control;
  if (!endpoint) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint.base_url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || !isLoopbackRuntimeControlHost(parsed.hostname)) {
    return false;
  }
  const port = Number.parseInt(compact(parsed.port), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function remoteRuntimeControlPortFromStartup(startup: StartupReport): number {
  const endpoint = startup.runtime_control;
  if (!endpoint) {
    throw new Error('Remote Redeven startup report did not include Desktop runtime-control. Restart this SSH runtime with the current Desktop runtime before connecting it to a provider.');
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint.base_url);
  } catch {
    throw new Error('Remote Redeven startup report returned an invalid runtime-control URL.');
  }
  if (parsed.protocol !== 'http:' || !isLoopbackRuntimeControlHost(parsed.hostname)) {
    throw new Error('Remote Redeven runtime-control must listen on local HTTP loopback.');
  }
  const port = Number.parseInt(compact(parsed.port), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Remote Redeven startup report did not include a usable runtime-control port.');
  }
  return port;
}

function forwardedRuntimeControlEndpoint(
  endpoint: DesktopRuntimeControlEndpoint,
  localPort: number,
): DesktopRuntimeControlEndpoint {
  return {
    ...endpoint,
    base_url: localForwardURL(localPort),
  };
}

function localForwardURL(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

async function waitForForwardedLocalUIOpenable(url: string, timeoutMs: number, signal?: AbortSignal): Promise<StartupReport | null> {
  const deadline = Date.now() + timeoutMs;
  let latestStartup: StartupReport | null = null;
  for (;;) {
    throwIfSSHRuntimeCanceled(signal);
    const startup = await loadExternalLocalUIStartup(url, Math.min(timeoutMs, DEFAULT_SSH_POLL_INTERVAL_MS));
    if (startup) {
      latestStartup = startup;
      if (runtimeServiceIsOpenable(startup.runtime_service)) {
        return startup;
      }
      if (startup.runtime_service?.open_readiness?.state === 'blocked') {
        return startup;
      }
    }
    if (Date.now() >= deadline) {
      return latestStartup;
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

function buildSSHAskPassScript(): string {
  return [
    '#!/bin/sh',
    'set -eu',
    'if [ "${REDEVEN_DESKTOP_SSH_PASSWORD+x}" = "x" ]; then',
    '  printf "%s\\n" "$REDEVEN_DESKTOP_SSH_PASSWORD"',
    '  exit 0',
    'fi',
    'prompt="${1:-SSH password}"',
    'if command -v osascript >/dev/null 2>&1; then',
    '  osascript -e \'display dialog prompt default answer "" with hidden answer buttons {"Cancel", "OK"} default button "OK" cancel button "Cancel"\' -e \'text returned of result\' -- "$prompt"',
    '  exit 0',
    'fi',
    'if command -v ssh-askpass >/dev/null 2>&1; then',
    '  exec ssh-askpass "$prompt"',
    'fi',
    'echo "Redeven Desktop could not open a password prompt for SSH authentication." >&2',
    'exit 1',
  ].join('\n');
}

async function createSSHAskPassScript(tempDir: string, authMode: DesktopSSHAuthMode): Promise<string | undefined> {
  if (authMode !== 'password') {
    return undefined;
  }
  const scriptPath = path.join(tempDir, 'redeven-ssh-askpass.sh');
  await fs.writeFile(scriptPath, buildSSHAskPassScript(), { mode: 0o700 });
  return scriptPath;
}

async function runSSHOnce(
  sshBinary: string,
  args: readonly string[],
  auth: SSHCommandAuthContext,
  logs: MutableRecentLogs,
  key: keyof MutableRecentLogs,
  onLog: StartManagedSSHRuntimeArgs['onLog'],
  stdinData?: Buffer,
  signal?: AbortSignal,
): Promise<SSHCommandResult> {
  return new Promise<SSHCommandResult>((resolve, reject) => {
    let child: SpawnedSSHProcess;
    try {
      child = spawnSSHProcess(sshBinary, args, auth, stdinData, signal);
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let spawnError: Error | null = null;

    child.once('error', (error) => {
      spawnError = error instanceof Error ? error : new Error(String(error));
    });

    if (shouldPipeSSHStdin(auth, stdinData)) {
      if (stdinData) {
        child.stdin?.end(stdinData);
      } else {
        child.stdin?.end();
      }
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

    child.once('close', (exitCode, closeSignal) => {
      if (signal?.aborted) {
        reject(new DesktopSSHRuntimeCanceledError());
        return;
      }
      if (spawnError) {
        if (isAbortError(spawnError)) {
          reject(new DesktopSSHRuntimeCanceledError());
          return;
        }
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
        signal: closeSignal,
        stdout,
        stderr,
      });
    });
  });
}

async function stopRemoteRuntimeProcess(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  pid: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  signal?: AbortSignal;
}>): Promise<void> {
  if (!Number.isInteger(args.pid) || args.pid <= 0) {
    return;
  }
  await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand(buildManagedSSHStopScript(), 'redeven-ssh-stop', [
        String(args.pid),
      ]),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
  );
}

async function waitForMasterReady(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  startupTimeoutMs: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
  getMasterProcess: () => SpawnedSSHProcess | null;
}>): Promise<void> {
  const deadline = Date.now() + args.startupTimeoutMs;
  for (;;) {
    throwIfSSHRuntimeCanceled(args.signal);
    const masterProcess = args.getMasterProcess();
    if (!masterProcess) {
      throw readinessFailure('Desktop failed to start the SSH control connection.', args.logs, {
        code: 'ssh_connection_failed',
        title: 'SSH Connection Failed',
        summary: `SSH connection to "${desktopSSHAuthority(args.target)}" failed.`,
        detail: 'Desktop could not create the reusable SSH control socket.',
        recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }
    if (masterProcess.exitCode !== null || masterProcess.signalCode) {
      throw readinessFailure('Desktop could not establish the SSH control connection.', args.logs, {
        code: 'ssh_connection_failed',
        title: 'SSH Connection Failed',
        summary: `SSH connection to "${desktopSSHAuthority(args.target)}" failed.`,
        detail: 'The SSH control connection exited before it became ready.',
        recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }

    const result = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
        '-O', 'check',
        ...sshTargetArgs(args.target),
      ],
      args.auth,
      args.logs,
      'master_stderr',
      args.onLog,
      undefined,
      args.signal,
    );
    if (result.exit_code === 0) {
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_control_ready',
        'SSH control connection is ready',
        'Desktop established the reusable SSH control socket.',
      );
      return;
    }
    if (Date.now() >= deadline) {
      throw readinessFailure('Timed out waiting for the SSH control connection to become ready.', args.logs, {
        code: 'ssh_connection_failed',
        title: 'SSH Connection Timed Out',
        summary: `SSH connection to "${desktopSSHAuthority(args.target)}" timed out.`,
        detail: 'Desktop could not confirm the reusable SSH control socket before the startup timeout.',
        recoveryHint: 'Check VPN status, firewall rules, SSH config, and the configured SSH connect timeout.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

async function probeRemoteRuntimeCompatibility(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  runtimeReleaseTag: string;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<DesktopSSHRemoteRuntimeProbeResult> {
  throwIfSSHRuntimeCanceled(args.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_checking_runtime',
    'Checking remote runtime',
    `Looking for a Desktop-managed Redeven ${args.runtimeReleaseTag} runtime on the SSH host.`,
  );
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand(buildManagedSSHRuntimeProbeScript(), 'redeven-ssh-runtime-probe', [
        args.target.runtime_root,
        args.runtimeReleaseTag,
      ]),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not probe the managed Redeven runtime over SSH.', args.logs, {
      code: 'ssh_runtime_status_unavailable',
      title: 'SSH Runtime Status Unavailable',
      detail: 'Desktop reached the SSH host, but the runtime probe command did not complete successfully.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
  try {
    const probe = parseManagedSSHRuntimeProbeResult(result.stdout);
    if (probe.status === 'ready') {
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_runtime_ready',
        'Remote runtime is ready',
        describeManagedSSHRuntimeProbeResult(probe),
      );
    }
    return probe;
  } catch (error) {
    throw readinessFailure(
      error instanceof Error ? error.message : 'Desktop received an invalid SSH runtime probe result.',
      args.logs,
      {
        code: 'ssh_runtime_status_unavailable',
        title: 'SSH Runtime Status Invalid',
        detail: 'The SSH host returned a runtime probe response Desktop could not parse.',
        targetLabel: desktopSSHAuthority(args.target),
      },
    );
  }
}

async function probeRemotePlatform(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<DesktopSSHRemotePlatform> {
  throwIfSSHRuntimeCanceled(args.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_detecting_platform',
    'Detecting remote platform',
    'Desktop is checking the remote OS and CPU architecture before choosing a runtime package.',
  );
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand('set -eu\nuname -s\nuname -m', 'redeven-ssh-probe-platform'),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not determine the remote platform for SSH bootstrap.', args.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'Remote Platform Detection Failed',
      detail: 'Desktop reached the SSH host, but could not detect the remote OS and CPU architecture.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
  const lines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) {
    throw readinessFailure('Desktop received an incomplete remote platform probe result over SSH.', args.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'Remote Platform Detection Failed',
      detail: 'The SSH host returned incomplete platform information.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
  return resolveDesktopSSHRemotePlatform(lines[0], lines[1]);
}

async function createRemoteTempDir(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<string> {
  throwIfSSHRuntimeCanceled(args.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_creating_upload_dir',
    'Preparing remote upload directory',
    'Desktop is creating a private temporary directory on the SSH host.',
  );
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand('set -eu\numask 077\nmktemp -d "${TMPDIR:-/tmp}/redeven-ssh-upload.XXXXXX"', 'redeven-ssh-create-upload-dir'),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not allocate a remote temporary directory for SSH upload.', args.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Install Failed',
      detail: 'Desktop could not create a temporary upload directory on the SSH host.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
  const remoteDir = compact(result.stdout);
  if (remoteDir === '') {
    throw readinessFailure('Desktop received an empty remote upload directory from SSH bootstrap.', args.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Install Failed',
      detail: 'The SSH host did not report the temporary upload directory path.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
  return remoteDir;
}

async function removeRemotePath(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  remotePath: string;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  signal?: AbortSignal;
}>): Promise<void> {
  if (compact(args.remotePath) === '') {
    return;
  }
  await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand('set -eu\nrm -rf "$1"', 'redeven-ssh-cleanup-path', [
        args.remotePath,
      ]),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
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
  auth: SSHCommandAuthContext;
  runtimeReleaseTag: string;
  installScriptURL: string;
  forceRuntimeUpdate?: boolean;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<void> {
  throwIfSSHRuntimeCanceled(args.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_remote_installing',
    'Installing runtime on SSH host',
    `The host is downloading and installing Redeven ${args.runtimeReleaseTag}. This can take a minute on first connection.`,
  );
  const result = await runSSHOnce(
    args.sshBinary,
    [
      ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
      ...sshTargetArgs(args.target),
      remoteShellCommand(buildManagedSSHRemoteInstallScript(), 'redeven-ssh-remote-install', [
        args.target.runtime_root,
        args.runtimeReleaseTag,
        args.installScriptURL,
        args.forceRuntimeUpdate === true ? '1' : '0',
      ]),
    ],
    args.auth,
    args.logs,
    'control_stderr',
    args.onLog,
    undefined,
    args.signal,
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not install Redeven on the remote host using the remote installer.', args.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Install Failed',
      detail: 'The remote install script did not complete successfully on the SSH host.',
      recoveryHint: 'Check network access from the SSH host to the Redeven release source, shell permissions, and the runtime root.',
      targetLabel: desktopSSHAuthority(args.target),
    });
  }
}

async function prepareDesktopSSHUploadAsset(args: Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  platform: DesktopSSHRemotePlatform;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<PreparedDesktopSSHUploadAsset> {
  try {
    throwIfSSHRuntimeCanceled(args.signal);
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_preparing_upload',
      'Preparing local runtime package',
      `Desktop is locating the ${args.platform.platform_label} Redeven ${args.runtimeReleaseTag} archive for upload.`,
    );
    const asset = await prepareDesktopRuntimeUploadAsset({
      runtimeReleaseTag: args.runtimeReleaseTag,
      releaseBaseURL: args.target.release_base_url,
      assetCacheRoot: args.assetCacheRoot,
      sourceRuntimeRoot: args.sourceRuntimeRoot,
      platform: args.platform,
      fetchPolicy: {
        ...args.fetchPolicy,
        signal: args.signal,
      },
      signal: args.signal,
    });
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_preparing_upload',
      desktopSSHUploadAssetPreparedTitle(asset),
      desktopSSHUploadAssetPreparedDetail(asset, args.platform, args.runtimeReleaseTag),
    );
    return asset;
  } catch (error) {
    if (error instanceof DesktopOperationFailureError) {
      throw new DesktopSSHUploadAssetPreparationError(error.presentation, { cause: error });
    }
    throw new DesktopSSHUploadAssetPreparationError(
      `Desktop could not prepare the ${args.platform.platform_label} Redeven runtime package locally: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function desktopSSHUploadAssetPreparedTitle(asset: PreparedDesktopSSHUploadAsset): string {
  if (asset.source === 'source_build') {
    return 'Built local runtime package';
  }
  if (asset.source === 'source_build_cache') {
    return 'Using cached local runtime package';
  }
  if (asset.cacheEntry?.from_cache) {
    return 'Using cached runtime package';
  }
  return 'Cached runtime package';
}

function desktopSSHUploadAssetPreparedDetail(
  asset: PreparedDesktopSSHUploadAsset,
  platform: DesktopSSHRemotePlatform,
  runtimeReleaseTag: string,
): string {
  if (asset.source === 'source_build') {
    return `Desktop built the ${platform.platform_label} Redeven ${runtimeReleaseTag} package from the current checkout.`;
  }
  if (asset.source === 'source_build_cache') {
    return `Desktop is reusing the ${platform.platform_label} Redeven ${runtimeReleaseTag} package built from this Desktop session.`;
  }
  if (asset.cacheEntry?.from_cache) {
    return `Desktop is reusing the verified ${platform.platform_label} Redeven ${runtimeReleaseTag} package.`;
  }
  return `Desktop downloaded and verified the ${platform.platform_label} Redeven ${runtimeReleaseTag} package for future SSH hosts.`;
}

async function installRemoteRuntimeViaDesktopUpload(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  runtimeReleaseTag: string;
  platform: DesktopSSHRemotePlatform;
  archiveData: Buffer;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<void> {
  throwIfSSHRuntimeCanceled(args.signal);
  const remoteTempDir = await createRemoteTempDir(args);
  const remoteArchivePath = `${remoteTempDir}/redeven.tar.gz`;

  try {
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_uploading_archive',
      'Uploading runtime package',
      `Desktop is sending the ${args.platform.release_package_name} archive to the SSH host.`,
    );
    const uploadResult = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
        ...sshTargetArgs(args.target),
        remoteShellCommand('set -eu\ncat > "$1"', 'redeven-ssh-upload-archive', [
          remoteArchivePath,
        ]),
      ],
      args.auth,
      args.logs,
      'control_stderr',
      args.onLog,
      args.archiveData,
      args.signal,
    );
    if (uploadResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not upload the ${args.platform.release_package_name} release archive over SSH.`,
        args.logs,
        {
          code: 'ssh_runtime_install_failed',
          title: 'SSH Runtime Upload Failed',
          detail: 'Desktop could not copy the runtime package archive to the SSH host.',
          recoveryHint: 'Check SSH permissions, available disk space, and the remote temporary directory.',
          targetLabel: desktopSSHAuthority(args.target),
        },
      );
    }

    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_installing_upload',
      'Installing uploaded runtime',
      `The SSH host is unpacking Redeven ${args.runtimeReleaseTag} and writing the Desktop runtime stamp.`,
    );
    const installResult = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
        ...sshTargetArgs(args.target),
        remoteShellCommand(buildManagedSSHUploadedInstallScript(), 'redeven-ssh-upload-install', [
          args.target.runtime_root,
          args.runtimeReleaseTag,
          remoteArchivePath,
          remoteTempDir,
        ]),
      ],
      args.auth,
      args.logs,
      'control_stderr',
      args.onLog,
      undefined,
      args.signal,
    );
    if (installResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not install the uploaded ${args.platform.platform_label} Redeven package on the remote host.`,
        args.logs,
        {
          code: 'ssh_runtime_install_failed',
          title: 'SSH Runtime Install Failed',
          detail: 'The SSH host could not unpack or stamp the uploaded runtime package.',
          recoveryHint: 'Check runtime root permissions, available disk space, and shell access on the SSH host.',
          targetLabel: desktopSSHAuthority(args.target),
        },
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
  auth: SSHCommandAuthContext;
  runtimeReleaseTag: string;
  installScriptURL: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  forceRuntimeUpdate?: boolean;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
}>): Promise<void> {
  const initialProbe = await probeRemoteRuntimeCompatibility(args);
  const shouldReplaceRuntimePackage = args.forceRuntimeUpdate === true;
  if (initialProbe.status === 'ready' && !shouldReplaceRuntimePackage) {
    return;
  }
  if (!shouldReplaceRuntimePackage && initialProbe.status !== 'missing_binary') {
    const maintenance = buildDesktopRuntimeMaintenanceRequirement({
      kind: 'runtime_update_required',
      required_for: 'open',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: true,
      has_active_work: false,
      active_work_label: 'No active work',
      current_runtime_version: initialProbe.reported_release_tag ?? undefined,
      target_runtime_version: initialProbe.expected_release_tag,
      message: 'Update this SSH runtime before starting it with the bundled runtime.',
    });
    throw new DesktopSSHRuntimeMaintenanceRequiredError(
      maintenance.message,
      maintenance,
      formatRecentLogsForMaintenanceDetails(args.logs),
    );
  }

  const failures: string[] = [
    shouldReplaceRuntimePackage
      ? `existing runtime will be replaced: ${describeManagedSSHRuntimeProbeResult(initialProbe)}`
      : `existing runtime: ${describeManagedSSHRuntimeProbeResult(initialProbe)}`,
  ];
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
            sourceRuntimeRoot: args.sourceRuntimeRoot,
            platform,
            fetchPolicy: args.fetchPolicy,
            onProgress: args.onProgress,
            signal: args.signal,
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
          auth: args.auth,
          runtimeReleaseTag: args.runtimeReleaseTag,
          platform,
          archiveData: preparedUpload.archiveData,
          logs: args.logs,
          onLog: args.onLog,
          onProgress: args.onProgress,
          signal: args.signal,
        });
        const uploadProbe = await probeRemoteRuntimeCompatibility(args);
        if (uploadProbe.status === 'ready') {
          return;
        }
        failures.push(`${strategy}: ${describeManagedSSHRuntimeProbeResult(uploadProbe)}`);
        if (args.target.bootstrap_strategy === 'auto') {
          break;
        }
        continue;
      }

      await installRemoteRuntimeViaRemoteInstall(args);
      const installProbe = await probeRemoteRuntimeCompatibility(args);
      if (installProbe.status === 'ready') {
        return;
      }
      failures.push(`${strategy}: ${describeManagedSSHRuntimeProbeResult(installProbe)}`);
    } catch (error) {
      failures.push(`${strategy}: ${error instanceof Error ? error.message : String(error)}`);
      if (strategy === 'desktop_upload' && args.target.bootstrap_strategy === 'auto') {
        throw error;
      }
    }
  }

  const attempts = failures.map((failure) => `- ${failure}`).join('\n');
  throw readinessFailure(
    `Desktop could not install the remote Redeven runtime over SSH.\n\nAttempts:\n${attempts}`,
    args.logs,
    {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Install Failed',
      summary: 'Desktop could not install the remote Redeven runtime over SSH.',
      detail: attempts,
      recoveryHint: 'Review the install attempt details and check SSH permissions, network access, runtime root, and disk space.',
      targetLabel: desktopSSHAuthority(args.target),
    },
  );
}

async function waitForRemoteStartupReport(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  sessionToken: string;
  runtimeReleaseTag: string;
  startupTimeoutMs: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  signal?: AbortSignal;
  getControlProcess: () => SpawnedSSHProcess | null;
}>): Promise<ManagedSSHRemoteStartup> {
  const deadline = Date.now() + args.startupTimeoutMs;
  const script = buildManagedSSHReportReadScript();
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_waiting_report',
    'Waiting for runtime readiness',
    'Redeven is starting on the SSH host and writing its startup report.',
  );
  for (;;) {
    throwIfSSHRuntimeCanceled(args.signal);
    const controlProcess = args.getControlProcess();
    if (!controlProcess) {
      throw readinessFailure('Desktop lost the SSH runtime bootstrap session before Redeven reported readiness.', args.logs, {
        code: 'ssh_runtime_launch_failed',
        title: 'SSH Runtime Launch Failed',
        detail: 'The remote launch command ended before Desktop could read the startup report.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }

    const result = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
        ...sshTargetArgs(args.target),
        remoteShellCommand(script, 'redeven-ssh-read-report', [
          args.target.runtime_root,
          args.sessionToken,
        ]),
      ],
      args.auth,
      args.logs,
      'control_stderr',
      args.onLog,
      undefined,
      args.signal,
    );
    if (result.exit_code === 0) {
      try {
        const launchReport = parseLaunchReport(result.stdout);
        if (launchReport.status === 'blocked') {
          const classification = classifyDesktopRuntimeBlockedLaunchReport(launchReport, {
            target_runtime_version: args.runtimeReleaseTag,
          });
          if (
            classification.kind === 'restart_required'
            && desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable(classification.maintenance)
          ) {
            if (Date.now() >= deadline) {
              throw readinessTimeoutFailure(
                classification.maintenance.message,
                args.logs,
                {
                  title: 'SSH Runtime Launch Timed Out',
                  detail: 'Redeven is running on the SSH host, but Desktop could not verify the management socket before the timeout.',
                  targetLabel: desktopSSHAuthority(args.target),
                },
              );
            }
            await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
            continue;
          }
          throw new Error(`Remote Redeven could not start:\n${formatBlockedLaunchDiagnostics(launchReport)}`);
        }
        return {
          startup: launchReport.startup,
          launch_mode: launchReport.status === 'attached' ? 'attached' : 'spawned',
        };
      } catch (error) {
        if (error instanceof DesktopSSHRuntimeReadinessTimeoutError) {
          throw error;
        }
        throw readinessFailure(
          error instanceof Error ? error.message : 'Remote Redeven startup report was invalid.',
          args.logs,
          {
            code: 'ssh_runtime_launch_failed',
            title: 'SSH Runtime Startup Report Invalid',
            detail: 'Redeven started on the SSH host but wrote a startup report Desktop could not use.',
            targetLabel: desktopSSHAuthority(args.target),
          },
        );
      }
    }

    if (controlProcess.exitCode !== null || controlProcess.signalCode) {
      if (controlProcess.exitCode === 0 && !controlProcess.signalCode) {
        if (Date.now() >= deadline) {
          throw readinessTimeoutFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.logs, {
            title: 'SSH Runtime Launch Timed Out',
            detail: 'Redeven did not write its startup report on the SSH host before the timeout.',
            targetLabel: desktopSSHAuthority(args.target),
          });
        }
        await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
        continue;
      }
      const exitReason = controlProcess.exitCode !== null
        ? `exit code ${controlProcess.exitCode}`
        : `signal ${controlProcess.signalCode}`;
      throw readinessFailure(`Remote Redeven launcher failed before reporting readiness (${exitReason}).`, args.logs, {
        code: 'ssh_runtime_launch_failed',
        title: 'SSH Runtime Launch Failed',
        detail: 'The remote Redeven process exited before Desktop could read its startup report.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }

    if (Date.now() >= deadline) {
      throw readinessTimeoutFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.logs, {
        title: 'SSH Runtime Launch Timed Out',
        detail: 'Redeven did not write its startup report on the SSH host before the timeout.',
        targetLabel: desktopSSHAuthority(args.target),
      });
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

type ManagedSSHRuntimeAttachPolicy =
  | Readonly<{ action: 'reuse' }>
  | Readonly<{ action: 'replace'; message: string }>
  | Readonly<{ action: 'block'; message: string; maintenance: DesktopRuntimeMaintenanceRequirement }>;

type RuntimeIdentityMismatchDiagnostic = Readonly<{
  expected_runtime_version?: string;
  observed_runtime_version?: string;
  observed_pid?: number;
  state_dir?: string;
  runtime_control_base_url?: string;
  binary_path?: string;
  desktop_owner_id?: string;
}>;

function startupReportsStoppablePID(startup: StartupReport): boolean {
  const pid = Number(startup.pid ?? Number.NaN);
  return Number.isInteger(pid) && pid > 0;
}

function managedSSHRuntimeBinaryPath(target: DesktopSSHEnvironmentDetails, runtimeReleaseTag: string): string {
  const runtimeRoot = compact(target.runtime_root);
  const rootLabel = runtimeRoot === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
    ? '~/.redeven'
    : runtimeRoot;
  return `${rootLabel.replace(/\/+$/u, '')}/runtime/releases/${runtimeReleaseTag}/bin/redeven`;
}

function runtimeIdentityMismatchDiagnostic(
  startup: StartupReport,
  args: Readonly<{
    target: DesktopSSHEnvironmentDetails;
    runtimeReleaseTag: string;
    desktopOwnerID: string;
  }>,
): RuntimeIdentityMismatchDiagnostic {
  const runtimeService = startup.runtime_service;
  const pid = Number(startup.pid ?? Number.NaN);
  return {
    expected_runtime_version: args.runtimeReleaseTag,
    observed_runtime_version: compact(runtimeService?.runtime_version) || undefined,
    ...(Number.isInteger(pid) && pid > 0 ? { observed_pid: pid } : {}),
    state_dir: compact(startup.state_dir) || compact(args.target.runtime_root) || undefined,
    runtime_control_base_url: compact(startup.runtime_control?.base_url) || undefined,
    binary_path: managedSSHRuntimeBinaryPath(args.target, args.runtimeReleaseTag),
    desktop_owner_id: compact(startup.desktop_owner_id) || compact(startup.runtime_control?.desktop_owner_id) || args.desktopOwnerID,
  };
}

function formatRuntimeIdentityMismatchDiagnostic(diagnostic: RuntimeIdentityMismatchDiagnostic): string {
  const rows: [string, unknown][] = [
    ['expected_runtime_version', diagnostic.expected_runtime_version],
    ['observed_runtime_version', diagnostic.observed_runtime_version],
    ['observed_pid', diagnostic.observed_pid],
    ['state_dir', diagnostic.state_dir],
    ['runtime_control_base_url', diagnostic.runtime_control_base_url],
    ['binary_path', diagnostic.binary_path],
    ['desktop_owner_id', diagnostic.desktop_owner_id],
  ];
  return rows
    .map(([key, value]) => {
      const text = compact(value);
      return text === '' ? '' : `${key}=${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function managedSSHRuntimeAttachPolicy(
  startup: StartupReport,
  args: Readonly<{
    expectedRuntimeIdentity: RuntimeServiceIdentity;
    requireDesktopModelSource: boolean;
    allowActiveWorkReplacement: boolean;
    allowRuntimeReplacement: boolean;
  }>,
): ManagedSSHRuntimeAttachPolicy {
  const runtimeService = startup.runtime_service;
  const identityMismatch = !runtimeServiceMatchesIdentity(runtimeService, args.expectedRuntimeIdentity);
  const needsRuntimeUpdate = runtimeServiceNeedsRuntimeUpdate(runtimeService);
  const runtimeControlUnavailable = !startupHasForwardableRuntimeControl(startup);
  const modelSourceUnsupported = args.requireDesktopModelSource
    && !runtimeServiceSupportsDesktopModelSource(runtimeService);

  if (!identityMismatch && !needsRuntimeUpdate && !runtimeControlUnavailable && !modelSourceUnsupported) {
    return { action: 'reuse' };
  }

  const maintenanceKind = modelSourceUnsupported
    ? 'desktop_model_source_requires_runtime_update'
    : needsRuntimeUpdate
      ? 'runtime_update_required'
      : 'runtime_restart_required';
  const maintenanceRequiredFor = modelSourceUnsupported ? 'desktop_model_source' : 'open';
  const maintenanceMessage = modelSourceUnsupported
    ? 'Update and restart this SSH runtime before Desktop can make your local model settings available here.'
    : needsRuntimeUpdate
      ? 'Update and restart this SSH runtime before opening this environment.'
      : runtimeControlUnavailable
        ? 'Restart this SSH runtime so Desktop can prepare runtime-control before provider linking or opening this environment.'
        : 'Restart this SSH runtime before opening this environment.';
  const maintenance = buildDesktopRuntimeMaintenanceRequirement({
    kind: maintenanceKind,
    required_for: maintenanceRequiredFor,
    recovery_action: needsRuntimeUpdate || modelSourceUnsupported ? 'update_runtime' : 'restart_runtime',
    can_desktop_start: false,
    can_desktop_restart: startupReportsStoppablePID(startup),
    has_active_work: runtimeServiceHasActiveWork(runtimeService),
    active_work_label: formatRuntimeServiceWorkload(runtimeService),
    current_runtime_version: runtimeService?.runtime_version,
    target_runtime_version: args.expectedRuntimeIdentity.runtime_version,
    message: maintenanceMessage,
  });

  if (!args.allowRuntimeReplacement) {
    return {
      action: 'block',
      message: maintenanceMessage,
      maintenance,
    };
  }
  if (runtimeServiceHasActiveWork(runtimeService) && !args.allowActiveWorkReplacement) {
    return {
      action: 'block',
      message: modelSourceUnsupported
        ? 'This SSH runtime needs to update before Desktop can prepare the Desktop model source, but active work is still running.'
        : runtimeControlUnavailable
          ? 'This SSH runtime needs to restart before Desktop can prepare runtime-control, but active work is still running.'
          : 'This SSH runtime needs to restart before Desktop can open it, but active work is still running.',
      maintenance,
    };
  }
  if (!startupReportsStoppablePID(startup)) {
    return {
      action: 'block',
      message: modelSourceUnsupported
        ? 'This SSH runtime needs to update before Desktop can prepare the Desktop model source, but it did not report a process id Desktop can stop.'
        : runtimeControlUnavailable
          ? 'This SSH runtime needs to restart before Desktop can prepare runtime-control, but it did not report a process id Desktop can stop.'
          : 'This SSH runtime needs to restart before Desktop can open it, but it did not report a process id Desktop can stop.',
      maintenance,
    };
  }
  return {
    action: 'replace',
    message: modelSourceUnsupported
      ? 'Restarting SSH runtime so Desktop can prepare the Desktop model source.'
      : runtimeControlUnavailable
        ? 'Restarting SSH runtime so Desktop can prepare runtime-control.'
        : 'Restarting SSH runtime so Desktop can open the requested runtime version.',
  };
}

async function startManagedSSHRuntimeInternal(
  args: StartManagedSSHRuntimeArgs,
  openConnection: boolean,
): Promise<ManagedSSHRuntime | ManagedSSHRuntimeReady> {
  throwIfSSHRuntimeCanceled(args.signal);
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const desktopOwnerID = compact(args.desktopOwnerID);
  if (desktopOwnerID === '') {
    throw new Error('Desktop owner id is required before starting a managed SSH runtime.');
  }
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
    runtime_control_forward_stderr: '',
  };

  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-'));
  const controlSocketPath = path.join(tempDir, 'm.sock');
  const sessionToken = randomBytes(8).toString('hex');
  const auth: SSHCommandAuthContext = {
    mode: target.auth_mode,
    askPassScriptPath: await createSSHAskPassScript(tempDir, target.auth_mode),
    password: args.sshPassword,
  };

  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_connecting',
    'Opening SSH control connection',
    `Connecting to ${target.ssh_destination} with ${target.auth_mode === 'password' ? 'password prompt' : 'SSH key or agent'} authentication.`,
  );
  const masterProcess = spawnSSHProcess(sshBinary, [
    ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
    '-M',
    '-N',
    '-o', 'ControlMaster=yes',
    '-o', 'ControlPersist=no',
    ...sshTargetArgs(target),
  ], auth, undefined, args.signal);
  let masterSpawnError: Error | null = null;
  masterProcess.once('error', (error) => {
    masterSpawnError = error instanceof Error ? error : new Error(String(error));
  });
  bindRecentLog(masterProcess.stderr, 'master_stderr', logs, args.onLog);

  let controlProcess: SpawnedSSHProcess | null = null;
  let forwardProcess: SpawnedSSHProcess | null = null;
  let runtimeControlForwardProcess: SpawnedSSHProcess | null = null;
  let remoteRuntimePID: number | null = null;
  let remoteStopAttempted = false;
  let transportDisconnected = false;

  const disconnect = async () => {
    if (transportDisconnected) {
      return;
    }
    transportDisconnected = true;
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_cleaning_startup_resources',
      'Cleaning SSH startup resources',
      'Desktop is closing local SSH tunnels and temporary startup files.',
    );
    await stopChildProcess(forwardProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(runtimeControlForwardProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(controlProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(masterProcess, stopTimeoutMs).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  const stop = async () => {
    try {
      if (!remoteStopAttempted && remoteRuntimePID !== null) {
        remoteStopAttempted = true;
        await stopRemoteRuntimeProcess({
          sshBinary,
          target,
          controlSocketPath,
          connectTimeoutSeconds,
          auth,
          pid: remoteRuntimePID,
          logs,
          onLog: args.onLog,
          signal: args.signal,
        });
      }
    } finally {
      await disconnect();
    }
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
      auth,
      startupTimeoutMs,
      logs,
      onLog: args.onLog,
      onProgress: args.onProgress,
      signal: args.signal,
      getMasterProcess: () => masterProcess,
    });

    await ensureRemoteRuntimeInstalled({
      sshBinary,
      target,
      controlSocketPath,
      connectTimeoutSeconds,
      auth,
      runtimeReleaseTag,
      installScriptURL,
      assetCacheRoot,
      sourceRuntimeRoot: args.sourceRuntimeRoot,
      forceRuntimeUpdate: args.forceRuntimeUpdate,
      fetchPolicy: releaseFetchPolicy,
      logs,
      onLog: args.onLog,
      onProgress: args.onProgress,
      signal: args.signal,
    });

    let remoteLaunch: ManagedSSHRemoteStartup | null = null;
    let replacementAttempted = false;
    for (;;) {
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_starting_runtime',
        replacementAttempted ? 'Restarting remote runtime' : 'Starting remote runtime',
        replacementAttempted
          ? 'Desktop is restarting Redeven on the SSH host so the running Runtime Service matches this session.'
          : 'Desktop is launching Redeven on the SSH host.',
      );
      controlProcess = spawnSSHProcess(sshBinary, [
        ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
        ...sshTargetArgs(target),
        remoteShellCommand(buildManagedSSHStartScript(), 'redeven-ssh-start', [
          target.runtime_root,
          runtimeReleaseTag,
          sessionToken,
          desktopOwnerID,
        ]),
      ], auth, undefined, args.signal);
      let controlSpawnError: Error | null = null;
      controlProcess.once('error', (error) => {
        controlSpawnError = error instanceof Error ? error : new Error(String(error));
      });
      bindRecentLog(controlProcess.stdout, 'control_stdout', logs, args.onLog);
      bindRecentLog(controlProcess.stderr, 'control_stderr', logs, args.onLog);
      if (controlSpawnError) {
        throw controlSpawnError;
      }

      const launch = await waitForRemoteStartupReport({
        sshBinary,
        target,
        controlSocketPath,
        connectTimeoutSeconds,
        auth,
        sessionToken,
        runtimeReleaseTag,
        startupTimeoutMs,
        logs,
        onLog: args.onLog,
        onProgress: args.onProgress,
        signal: args.signal,
        getControlProcess: () => controlProcess,
      });
      remoteRuntimePID = launch.startup.pid ?? null;
      const attachPolicy = managedSSHRuntimeAttachPolicy(launch.startup, {
        expectedRuntimeIdentity: { runtime_version: runtimeReleaseTag },
        requireDesktopModelSource: false,
        allowActiveWorkReplacement: args.allowActiveWorkReplacement === true,
        allowRuntimeReplacement: args.forceRuntimeUpdate === true || args.allowActiveWorkReplacement === true,
      });
      if (attachPolicy.action === 'block') {
        throw new DesktopSSHRuntimeMaintenanceRequiredError(
          attachPolicy.message,
          attachPolicy.maintenance,
          formatRecentLogsForMaintenanceDetails(logs),
        );
      }
      if (attachPolicy.action === 'reuse') {
        remoteLaunch = launch;
        break;
      }
      if (replacementAttempted) {
        const identityDiagnostic = runtimeIdentityMismatchDiagnostic(launch.startup, {
          target,
          runtimeReleaseTag,
          desktopOwnerID,
        });
        throw readinessFailure('Desktop restarted the SSH runtime, but the running Runtime Service still does not match this session.', logs, {
          code: 'ssh_runtime_launch_failed',
          title: 'SSH Runtime Restart Failed',
          detail: [
            'The restarted runtime still reported an incompatible Runtime Service identity.',
            formatRuntimeIdentityMismatchDiagnostic(identityDiagnostic),
          ].filter(Boolean).join('\n\n'),
          targetLabel: desktopSSHAuthority(target),
        });
      }
      replacementAttempted = true;
      await stopRemoteRuntimeProcess({
        sshBinary,
        target,
        controlSocketPath,
        connectTimeoutSeconds,
        auth,
        pid: remoteRuntimePID ?? 0,
        logs,
        onLog: args.onLog,
        signal: args.signal,
      });
      await stopChildProcess(controlProcess, stopTimeoutMs).catch(() => undefined);
      controlProcess = null;
      remoteRuntimePID = null;
    }
    if (!remoteLaunch) {
      throw readinessFailure('Desktop could not resolve the final SSH Runtime Service startup report.', logs, {
        code: 'ssh_runtime_launch_failed',
        title: 'SSH Runtime Launch Failed',
        detail: 'Desktop did not receive a usable final startup report from the SSH host.',
        targetLabel: desktopSSHAuthority(target),
      });
    }
    const remoteStartup = remoteLaunch.startup;
    remoteRuntimePID = remoteStartup.pid ?? null;
    if (!openConnection) {
      return {
        startup: remoteStartup,
        runtime_handle: {
          runtime_kind: 'ssh',
          lifecycle_owner: 'external',
          launch_mode: remoteLaunch.launch_mode,
          stop,
        },
        disconnect,
        stop,
      };
    }

    const localPort = await allocateLocalForwardPort();
    const remotePort = remotePortFromStartup(remoteStartup);
    const runtimeControlPort = await allocateLocalForwardPort();
    const remoteRuntimeControlPort = remoteRuntimeControlPortFromStartup(remoteStartup);
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_opening_tunnel',
      'Opening local tunnel',
      `Forwarding 127.0.0.1:${localPort} to the remote Redeven port ${remotePort}.`,
    );
    forwardProcess = spawnSSHProcess(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      ...sshTargetArgs(target),
    ], auth, undefined, args.signal);
    let forwardSpawnError: Error | null = null;
    forwardProcess.once('error', (error) => {
      forwardSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(forwardProcess.stderr, 'forward_stderr', logs, args.onLog);
    if (forwardSpawnError) {
      throw forwardSpawnError;
    }

    runtimeControlForwardProcess = spawnSSHProcess(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `127.0.0.1:${runtimeControlPort}:127.0.0.1:${remoteRuntimeControlPort}`,
      ...sshTargetArgs(target),
    ], auth, undefined, args.signal);
    let runtimeControlForwardSpawnError: Error | null = null;
    runtimeControlForwardProcess.once('error', (error) => {
      runtimeControlForwardSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(runtimeControlForwardProcess.stderr, 'runtime_control_forward_stderr', logs, args.onLog);
    if (runtimeControlForwardSpawnError) {
      throw runtimeControlForwardSpawnError;
    }

    const forwardedURL = localForwardURL(localPort);
    const runtimeControlForwardURL = localForwardURL(runtimeControlPort);
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_verifying_tunnel',
      'Verifying forwarded Local UI',
      `Checking ${forwardedURL} before opening the environment window.`,
    );
    let forwardedStartup = await waitForForwardedLocalUIOpenable(
      forwardedURL,
      args.probeTimeoutMs ?? startupTimeoutMs,
      args.signal,
    );
    if (!forwardedStartup) {
      throw readinessFailure('Desktop created the SSH port forward but could not reach the forwarded Redeven Local UI.', logs, {
        code: 'ssh_forward_unavailable',
        title: 'SSH Tunnel Verification Failed',
        summary: 'Desktop could not reach the forwarded Redeven Local UI.',
        detail: 'The remote runtime started, but the local SSH tunnel did not expose an openable Local UI.',
        recoveryHint: 'Check SSH local forwarding permissions and whether the remote runtime is still listening.',
        targetLabel: desktopSSHAuthority(target),
      });
    }
    const startup: StartupReport = {
      ...remoteStartup,
      local_ui_url: forwardedStartup.local_ui_url,
      local_ui_urls: forwardedStartup.local_ui_urls,
      password_required: forwardedStartup.password_required,
      runtime_control: forwardedRuntimeControlEndpoint(remoteStartup.runtime_control!, runtimeControlPort),
      runtime_service: forwardedStartup.runtime_service ?? remoteStartup.runtime_service,
    };
    return {
      startup,
      local_forward_url: forwardedURL,
      runtime_control_forward_url: runtimeControlForwardURL,
      runtime_handle: {
        runtime_kind: 'ssh',
        lifecycle_owner: 'external',
        launch_mode: remoteLaunch.launch_mode,
        stop,
      },
      disconnect,
      stop,
    };
  } catch (error) {
    await disconnect();
    if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {
      throw new DesktopSSHRuntimeCanceledError();
    }
    if (error instanceof DesktopSSHRuntimeMaintenanceRequiredError) {
      throw error;
    }
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

export async function ensureManagedSSHRuntimeReady(
  args: Omit<StartManagedSSHRuntimeArgs, 'requireDesktopModelSource'>,
): Promise<ManagedSSHRuntimeReady> {
  return await startManagedSSHRuntimeInternal(args, false) as ManagedSSHRuntimeReady;
}

export async function openManagedSSHRuntimeConnection(
  args: ManagedSSHRuntimeConnectionInput,
): Promise<ManagedSSHRuntime> {
  throwIfSSHRuntimeCanceled(args.signal);
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const remoteStartup = args.ready.startup;
  if (args.requireDesktopModelSource === true && !runtimeServiceSupportsDesktopModelSource(remoteStartup.runtime_service)) {
    const expectedRuntimeIdentity = {
      runtime_version: normalizeRuntimeReleaseTag(args.runtimeReleaseTag ?? remoteStartup.runtime_service?.runtime_version ?? ''),
    };
    const maintenance = buildDesktopRuntimeMaintenanceRequirement({
      kind: 'desktop_model_source_requires_runtime_update',
      required_for: 'desktop_model_source',
      recovery_action: 'update_runtime',
      can_desktop_start: false,
      can_desktop_restart: startupReportsStoppablePID(remoteStartup),
      has_active_work: runtimeServiceHasActiveWork(remoteStartup.runtime_service),
      active_work_label: formatRuntimeServiceWorkload(remoteStartup.runtime_service),
      current_runtime_version: remoteStartup.runtime_service?.runtime_version,
      target_runtime_version: expectedRuntimeIdentity.runtime_version,
      message: 'Update and restart this SSH runtime before Desktop can make your local model settings available here.',
    });
    throw new DesktopSSHRuntimeMaintenanceRequiredError(
      maintenance.message,
      maintenance,
    );
  }
  const sshBinary = compact(args.sshBinary) || 'ssh';
  const tempRoot = compact(args.tempRoot) || os.tmpdir();
  const stopTimeoutMs = args.stopTimeoutMs ?? DEFAULT_SSH_STOP_TIMEOUT_MS;
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const logs: MutableRecentLogs = {
    master_stderr: '',
    control_stdout: '',
    control_stderr: '',
    forward_stderr: '',
    runtime_control_forward_stderr: '',
  };

  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-open-'));
  const controlSocketPath = path.join(tempDir, 'm.sock');
  const auth: SSHCommandAuthContext = {
    mode: target.auth_mode,
    askPassScriptPath: await createSSHAskPassScript(tempDir, target.auth_mode),
    password: args.sshPassword,
  };

  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_opening_tunnel',
    'Opening SSH connection',
    `Connecting to ${target.ssh_destination} for this open request.`,
  );
  const masterProcess = spawnSSHProcess(sshBinary, [
    ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
    '-M',
    '-N',
    '-o', 'ControlMaster=yes',
    '-o', 'ControlPersist=no',
    ...sshTargetArgs(target),
  ], auth, undefined, args.signal);
  let masterSpawnError: Error | null = null;
  masterProcess.once('error', (error) => {
    masterSpawnError = error instanceof Error ? error : new Error(String(error));
  });
  bindRecentLog(masterProcess.stderr, 'master_stderr', logs, args.onLog);

  let forwardProcess: SpawnedSSHProcess | null = null;
  let runtimeControlForwardProcess: SpawnedSSHProcess | null = null;
  let transportDisconnected = false;
  const disconnect = async () => {
    if (transportDisconnected) {
      return;
    }
    transportDisconnected = true;
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_cleaning_startup_resources',
      'Cleaning SSH connection resources',
      'Desktop is closing local SSH tunnels for this open request.',
    );
    await stopChildProcess(forwardProcess, stopTimeoutMs).catch(() => undefined);
    await stopChildProcess(runtimeControlForwardProcess, stopTimeoutMs).catch(() => undefined);
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
      auth,
      startupTimeoutMs: args.probeTimeoutMs ?? DEFAULT_SSH_STARTUP_TIMEOUT_MS,
      logs,
      onLog: args.onLog,
      onProgress: undefined,
      signal: args.signal,
      getMasterProcess: () => masterProcess,
    });

    const localPort = await allocateLocalForwardPort();
    const remotePort = remotePortFromStartup(remoteStartup);
    const runtimeControlPort = await allocateLocalForwardPort();
    const remoteRuntimeControlPort = remoteRuntimeControlPortFromStartup(remoteStartup);
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_opening_tunnel',
      'Opening local tunnel',
      `Forwarding 127.0.0.1:${localPort} to the remote Redeven port ${remotePort}.`,
    );
    forwardProcess = spawnSSHProcess(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      ...sshTargetArgs(target),
    ], auth, undefined, args.signal);
    let forwardSpawnError: Error | null = null;
    forwardProcess.once('error', (error) => {
      forwardSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(forwardProcess.stderr, 'forward_stderr', logs, args.onLog);
    if (forwardSpawnError) {
      throw forwardSpawnError;
    }

    runtimeControlForwardProcess = spawnSSHProcess(sshBinary, [
      ...sshSharedArgs(controlSocketPath, connectTimeoutSeconds, auth.mode),
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `127.0.0.1:${runtimeControlPort}:127.0.0.1:${remoteRuntimeControlPort}`,
      ...sshTargetArgs(target),
    ], auth, undefined, args.signal);
    let runtimeControlForwardSpawnError: Error | null = null;
    runtimeControlForwardProcess.once('error', (error) => {
      runtimeControlForwardSpawnError = error instanceof Error ? error : new Error(String(error));
    });
    bindRecentLog(runtimeControlForwardProcess.stderr, 'runtime_control_forward_stderr', logs, args.onLog);
    if (runtimeControlForwardSpawnError) {
      throw runtimeControlForwardSpawnError;
    }

    const forwardedURL = localForwardURL(localPort);
    const runtimeControlForwardURL = localForwardURL(runtimeControlPort);
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_verifying_tunnel',
      'Verifying forwarded Local UI',
      `Checking ${forwardedURL} before opening the environment window.`,
    );
    const forwardedStartup = await waitForForwardedLocalUIOpenable(
      forwardedURL,
      args.probeTimeoutMs ?? DEFAULT_SSH_STARTUP_TIMEOUT_MS,
      args.signal,
    );
    if (!forwardedStartup) {
      throw readinessFailure('Desktop created the SSH port forward but could not reach the forwarded Redeven Local UI.', logs, {
        code: 'ssh_forward_unavailable',
        title: 'SSH Tunnel Verification Failed',
        summary: 'Desktop could not reach the forwarded Redeven Local UI.',
        detail: 'The SSH runtime is running, but this open request could not verify the Local UI tunnel.',
        recoveryHint: 'Check SSH local forwarding permissions and whether the remote runtime is still listening.',
        targetLabel: desktopSSHAuthority(target),
      });
    }
    const startup: StartupReport = {
      ...remoteStartup,
      local_ui_url: forwardedStartup.local_ui_url,
      local_ui_urls: forwardedStartup.local_ui_urls,
      password_required: forwardedStartup.password_required,
      runtime_control: forwardedRuntimeControlEndpoint(remoteStartup.runtime_control!, runtimeControlPort),
      runtime_service: forwardedStartup.runtime_service ?? remoteStartup.runtime_service,
    };
    return {
      startup,
      local_forward_url: forwardedURL,
      runtime_control_forward_url: runtimeControlForwardURL,
      runtime_handle: args.ready.runtime_handle,
      disconnect,
      stop: async () => {
        try {
          await args.ready.stop();
        } finally {
          await disconnect();
        }
      },
    };
  } catch (error) {
    await disconnect();
    if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {
      throw new DesktopSSHRuntimeCanceledError('SSH open was canceled.');
    }
    if (error instanceof Error) {
      throw error;
    }
    throw readinessFailure(String(error), logs);
  }
}

export async function startManagedSSHRuntime(args: StartManagedSSHRuntimeArgs): Promise<ManagedSSHRuntime> {
  const {
    requireDesktopModelSource: _requireDesktopModelSource,
    ...readyArgs
  } = args;
  const ready = await ensureManagedSSHRuntimeReady(readyArgs);
  const runtime = await openManagedSSHRuntimeConnection({
    ...args,
    ready,
  });
  return {
    ...runtime,
    disconnect: async () => {
      try {
        await runtime.disconnect();
      } finally {
        await ready.disconnect();
      }
    },
    stop: async () => {
      try {
        await ready.stop();
      } finally {
        await runtime.disconnect();
      }
    },
  };
}
