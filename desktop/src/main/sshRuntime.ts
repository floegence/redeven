import { spawn, type ChildProcessByStdio, type SpawnOptions } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { gzipSync } from 'node:zlib';

import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  ensureDesktopSSHReleaseAsset,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
  type DesktopSSHReleaseFetchPolicy,
} from './sshReleaseAssets';
import { loadExternalLocalUIStartup } from './runtimeState';
import type { DesktopSessionRuntimeHandle, DesktopSessionRuntimeLaunchMode } from './sessionRuntime';
import type { StartupReport } from './startup';
import { formatBlockedLaunchDiagnostics, parseLaunchReport } from './launchReport';
import {
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
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
  runtimeServiceSupportsDesktopAIBrokerBinding,
  type RuntimeServiceIdentity,
} from '../shared/runtimeService';
import type { DesktopRuntimeMaintenanceRequirement } from '../shared/desktopRuntimeHealth';

const PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';
const DEFAULT_SSH_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_SSH_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_SSH_POLL_INTERVAL_MS = 200;
const MAX_RECENT_LOG_CHARS = 8_000;
export const MANAGED_SSH_RUNTIME_STAMP_FILENAME = 'desktop-runtime.stamp';
export const MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION = 1;

type SpawnedSSHProcess = ChildProcessByStdio<Writable | null, Readable | null, Readable>;
type RemoteInstallStrategy = 'desktop_upload' | 'remote_install';
type PreparedDesktopSSHUploadAsset = Readonly<{
  archiveData: Buffer;
}>;
type SSHCommandAuthContext = Readonly<{
  mode: DesktopSSHAuthMode;
  askPassScriptPath?: string;
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
  | 'ssh_binding_ai_broker'
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
  reverse_forward_stderr: string;
  forward_stderr: string;
}>;

type MutableRecentLogs = {
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
  reverse_forward_stderr: string;
  forward_stderr: string;
};

type SSHCommandResult = Readonly<{
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

type LocalCommandResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

class DesktopSSHUploadAssetPreparationError extends Error {
  constructor(message: string) {
    super(message);
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

  constructor(message: string, maintenance: DesktopRuntimeMaintenanceRequirement, details = '') {
    super(details.trim() === '' ? message : `${message}\n\n${details}`);
    this.name = 'DesktopSSHRuntimeMaintenanceRequiredError';
    this.maintenance = maintenance;
  }
}

export type ManagedSSHRuntime = Readonly<{
  startup: StartupReport;
  local_forward_url: string;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type ManagedSSHRuntimeAIBroker = Readonly<{
  local_url: string;
  token: string;
  session_id: string;
  ssh_runtime_key: `ssh:${string}`;
  expires_at_unix_ms: number;
}>;

type ManagedSSHRemoteStartup = Readonly<{
  startup: StartupReport;
  launch_mode: DesktopSessionRuntimeLaunchMode;
}>;

export type StartManagedSSHRuntimeArgs = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  sshBinary?: string;
  installScriptURL?: string;
  sourceRuntimeRoot?: string;
  tempRoot?: string;
  assetCacheRoot?: string;
  forceRuntimeUpdate?: boolean;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  probeTimeoutMs?: number;
  aiBroker?: ManagedSSHRuntimeAIBroker | null;
  signal?: AbortSignal;
  onLog?: (stream: 'master_stderr' | 'control_stdout' | 'control_stderr' | 'reverse_forward_stderr' | 'forward_stderr', chunk: string) => void;
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

function sshSpawnOptions(auth: SSHCommandAuthContext): SpawnOptions {
  if (auth.mode !== 'password' || !auth.askPassScriptPath) {
    return {};
  }
  return {
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0',
      SSH_ASKPASS: auth.askPassScriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
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
    'install_root_raw="$1"',
    `if [ "$install_root_raw" = "${DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR}" ]; then`,
    '  remote_tmp_dir="${TMPDIR:-/tmp}"',
    '  remote_user="${USER:-}"',
    '  if [ -z "$remote_user" ] && command -v id >/dev/null 2>&1; then',
    '    remote_user="$(id -u 2>/dev/null || true)"',
    '  fi',
    '  if [ -z "$remote_user" ]; then',
    '    remote_user="user"',
    '  fi',
    '  cache_base=""',
    '  if [ -n "${XDG_CACHE_HOME:-}" ]; then',
    '    xdg_parent="$(dirname "$XDG_CACHE_HOME")"',
    '    if [ -d "$XDG_CACHE_HOME" ] || { [ -d "$xdg_parent" ] && [ -w "$xdg_parent" ]; }; then',
    '      cache_base="$XDG_CACHE_HOME"',
    '    fi',
    '  fi',
    '  if [ -z "$cache_base" ] && [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ -w "$HOME" ]; then',
    '    cache_base="${HOME%/}/.cache"',
    '  fi',
    '  if [ -n "$cache_base" ]; then',
    '    install_root="${cache_base%/}/redeven-desktop/runtime"',
    '  else',
    '    install_root="${remote_tmp_dir%/}/redeven-desktop-runtime-${remote_user}"',
    '  fi',
    'else',
    '  install_root="$install_root_raw"',
    'fi',
  ].join('\n');
}

function buildManagedSSHRuntimePathShell(): string {
  return [
    'release_tag="$2"',
    'release_root="${install_root%/}/releases/${release_tag}"',
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
    'local_environment_root="${install_root%/}/local-environment"',
    'state_root="${local_environment_root}/state"',
    'session_token="$3"',
    'session_dir="${local_environment_root}/sessions/${session_token}"',
    'report_path="${session_dir}/startup-report.json"',
    'log_dir="${local_environment_root}/logs"',
    'log_path="${log_dir}/runtime-${session_token}.log"',
    'mkdir -p "$state_root" "$session_dir" "$log_dir"',
    'rm -f "$report_path"',
    'if [ ! -x "$binary" ]; then',
    '  echo "Redeven runtime is not installed at ${binary}" >&2',
    '  exit 1',
    'fi',
    'if command -v setsid >/dev/null 2>&1; then',
    '  setsid "$binary" run --state-root "$state_root" --mode desktop --desktop-managed --local-ui-bind 127.0.0.1:0 --startup-report-file "$report_path" >>"$log_path" 2>&1 </dev/null &',
    'else',
    '  nohup "$binary" run --state-root "$state_root" --mode desktop --desktop-managed --local-ui-bind 127.0.0.1:0 --startup-report-file "$report_path" >>"$log_path" 2>&1 </dev/null &',
    'fi',
    'printf "%s\\n" "$!" > "${session_dir}/launcher.pid"',
  ].join('\n');
}

export function buildManagedSSHReportReadScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    'session_token="$2"',
    'report_path="${install_root%/}/local-environment/sessions/${session_token}/startup-report.json"',
    'if [ ! -f "$report_path" ]; then',
    '  exit 1',
    'fi',
    'cat "$report_path"',
  ].join('\n');
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

async function runLocalCommand(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }>,
): Promise<LocalCommandResult> {
  throwIfSSHRuntimeCanceled(options.signal);
  return new Promise<LocalCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (isAbortError(error) || options.signal?.aborted) {
        reject(new DesktopSSHRuntimeCanceledError());
        return;
      }
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (options.signal?.aborted) {
        reject(new DesktopSSHRuntimeCanceledError());
        return;
      }
      if (exitCode === 0 && !signal) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${exitCode ?? 'unknown'}`;
      const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      reject(new Error(details ? `${command} failed with ${reason}:\n${details}` : `${command} failed with ${reason}`));
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

function localPortFromBrokerURL(rawURL: string): number {
  const parsed = new URL(rawURL);
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'http:' || (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1')) {
    throw new Error('Desktop AI Broker must listen on local HTTP loopback.');
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Desktop AI Broker URL is missing a valid port.');
  }
  return port;
}

async function openDesktopAIBrokerReverseForward(args: Readonly<{
  sshBinary: string;
  target: DesktopSSHEnvironmentDetails;
  controlSocketPath: string;
  connectTimeoutSeconds: number;
  auth: SSHCommandAuthContext;
  broker: ManagedSSHRuntimeAIBroker;
  startupTimeoutMs: number;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  signal?: AbortSignal;
}>): Promise<Readonly<{ process: SpawnedSSHProcess; remoteURL: string }>> {
  const localPort = localPortFromBrokerURL(args.broker.local_url);
  const proc = spawnSSHProcess(args.sshBinary, [
    ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-R', `127.0.0.1:0:127.0.0.1:${localPort}`,
    ...sshTargetArgs(args.target),
  ], args.auth, undefined, args.signal);

  let spawnError: Error | null = null;
  proc.once('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error));
  });

  const deadline = Date.now() + args.startupTimeoutMs;
  let allocatedPort: number | null = null;
  const observe = (chunk: string) => {
    args.logs.reverse_forward_stderr = appendRecentLog(args.logs.reverse_forward_stderr, chunk);
    args.onLog?.('reverse_forward_stderr', chunk);
    const match = args.logs.reverse_forward_stderr.match(/Allocated port\s+(\d+)/iu);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        allocatedPort = parsed;
      }
    }
  };
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', observe);
  if (proc.stdout) {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', observe);
  }

  for (;;) {
    throwIfSSHRuntimeCanceled(args.signal);
    if (spawnError) {
      throw spawnError;
    }
    if (allocatedPort !== null) {
      return {
        process: proc,
        remoteURL: `http://127.0.0.1:${allocatedPort}`,
      };
    }
    if (proc.exitCode !== null || proc.signalCode) {
      const exitReason = proc.exitCode !== null ? `exit code ${proc.exitCode}` : `signal ${proc.signalCode}`;
      throw readinessFailure(`Desktop AI Broker reverse forward failed before allocation (${exitReason}).`, args.logs);
    }
    if (Date.now() >= deadline) {
      throw readinessFailure('Timed out waiting for Desktop AI Broker reverse forward allocation.', args.logs);
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
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
      throw readinessFailure('Desktop failed to start the SSH control connection.', args.logs);
    }
    if (masterProcess.exitCode !== null || masterProcess.signalCode) {
      throw readinessFailure('Desktop could not establish the SSH control connection.', args.logs);
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
      throw readinessFailure('Timed out waiting for the SSH control connection to become ready.', args.logs);
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
        args.target.remote_install_dir,
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
    throw readinessFailure('Desktop could not probe the managed Redeven runtime over SSH.', args.logs);
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
        args.target.remote_install_dir,
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
    throw readinessFailure('Desktop could not install Redeven on the remote host using the remote installer.', args.logs);
  }
}

function writeTarOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  header.write(text, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function createSingleFileTarGzip(fileName: string, data: Buffer, mode: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(fileName, 0, Math.min(Buffer.byteLength(fileName), 100), 'ascii');
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, data.length, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1_000), 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar', 257, 5, 'ascii');
  header[262] = 0;
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumText = checksum.toString(8).padStart(6, '0').slice(-6);
  header.write(checksumText, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;

  const paddingLength = (512 - (data.length % 512)) % 512;
  return gzipSync(Buffer.concat([
    header,
    data,
    Buffer.alloc(paddingLength, 0),
    Buffer.alloc(1024, 0),
  ]));
}

async function readSourceRuntimeCommit(sourceRoot: string, signal?: AbortSignal): Promise<string> {
  const envCommit = compact(process.env.REDEVEN_DESKTOP_BUNDLE_COMMIT);
  if (envCommit !== '') {
    return envCommit;
  }
  try {
    const result = await runLocalCommand('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: sourceRoot, signal });
    return compact(result.stdout) || 'unknown';
  } catch {
    throwIfSSHRuntimeCanceled(signal);
    return 'unknown';
  }
}

async function buildSourceRuntimeAssets(sourceRoot: string, signal?: AbortSignal): Promise<void> {
  const scriptPath = path.join(sourceRoot, 'scripts', 'build_assets.sh');
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat?.isFile()) {
    throw new Error(`Redeven asset build script is missing: ${scriptPath}`);
  }
  await runLocalCommand(scriptPath, [], { cwd: sourceRoot, signal });
}

async function prepareSourceRuntimeUploadAsset(args: Readonly<{
  sourceRuntimeRoot: string;
  runtimeReleaseTag: string;
  assetCacheRoot: string;
  platform: DesktopSSHRemotePlatform;
  signal?: AbortSignal;
}>): Promise<PreparedDesktopSSHUploadAsset | null> {
  throwIfSSHRuntimeCanceled(args.signal);
  const sourceRoot = compact(args.sourceRuntimeRoot);
  if (sourceRoot === '') {
    return null;
  }
  const commandRoot = path.join(sourceRoot, 'cmd', 'redeven');
  const commandRootStat = await fs.stat(commandRoot).catch(() => null);
  if (!commandRootStat?.isDirectory()) {
    throw new DesktopSSHUploadAssetPreparationError(
      `Desktop SSH source runtime root is not a Redeven checkout: ${sourceRoot}`,
    );
  }

  await fs.mkdir(args.assetCacheRoot, { recursive: true });
  const buildRoot = await fs.mkdtemp(path.join(args.assetCacheRoot, 'source-runtime-'));
  try {
    const binaryPath = path.join(buildRoot, 'redeven');
    const buildTime = compact(process.env.REDEVEN_DESKTOP_BUNDLE_BUILD_TIME)
      || new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
    const commit = await readSourceRuntimeCommit(sourceRoot, args.signal);
    await buildSourceRuntimeAssets(sourceRoot, args.signal);
    await runLocalCommand('go', [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X main.Version=${args.runtimeReleaseTag} -X main.Commit=${commit} -X main.BuildTime=${buildTime}`,
      '-o',
      binaryPath,
      './cmd/redeven',
    ], {
      cwd: sourceRoot,
      env: {
        GOOS: args.platform.goos,
        GOARCH: args.platform.goarch,
        CGO_ENABLED: '0',
      },
      signal: args.signal,
    });
    throwIfSSHRuntimeCanceled(args.signal);

    return {
      archiveData: createSingleFileTarGzip('redeven', await fs.readFile(binaryPath), 0o755),
    };
  } catch (error) {
    throw new DesktopSSHUploadAssetPreparationError(
      `Desktop could not build a ${args.platform.platform_label} Redeven runtime from the current checkout: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true }).catch(() => undefined);
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
    const sourceAsset = await prepareSourceRuntimeUploadAsset({
      sourceRuntimeRoot: args.sourceRuntimeRoot ?? '',
      runtimeReleaseTag: args.runtimeReleaseTag,
      assetCacheRoot: args.assetCacheRoot,
      platform: args.platform,
      signal: args.signal,
    });
    if (sourceAsset) {
      throwIfSSHRuntimeCanceled(args.signal);
      return sourceAsset;
    }
    const asset = await ensureDesktopSSHReleaseAsset({
      releaseTag: args.runtimeReleaseTag,
      releaseBaseURL: args.target.release_base_url,
      platform: args.platform,
      cacheRoot: args.assetCacheRoot,
      fetchPolicy: {
        ...args.fetchPolicy,
        signal: args.signal,
      },
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
          args.target.remote_install_dir,
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
  const sourceRuntimeRoot = compact(args.sourceRuntimeRoot);
  const shouldForceInstall = args.forceRuntimeUpdate === true || sourceRuntimeRoot !== '';
  if (initialProbe.status === 'ready' && !shouldForceInstall) {
    return;
  }

  const failures: string[] = [
    shouldForceInstall
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
  auth: SSHCommandAuthContext;
  sessionToken: string;
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
      throw readinessFailure('Desktop lost the SSH runtime bootstrap session before Redeven reported readiness.', args.logs);
    }

    const result = await runSSHOnce(
      args.sshBinary,
      [
        ...sshSharedArgs(args.controlSocketPath, args.connectTimeoutSeconds, args.auth.mode),
        ...sshTargetArgs(args.target),
        remoteShellCommand(script, 'redeven-ssh-read-report', [
          args.target.remote_install_dir,
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
          throw new Error(`Remote Redeven could not start:\n${formatBlockedLaunchDiagnostics(launchReport)}`);
        }
        return {
          startup: launchReport.startup,
          launch_mode: launchReport.status === 'attached' ? 'attached' : 'spawned',
        };
      } catch (error) {
        throw readinessFailure(
          error instanceof Error ? error.message : 'Remote Redeven startup report was invalid.',
          args.logs,
        );
      }
    }

    if (controlProcess.exitCode !== null || controlProcess.signalCode) {
      if (controlProcess.exitCode === 0 && !controlProcess.signalCode) {
        if (Date.now() >= deadline) {
          throw readinessFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.logs);
        }
        await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
        continue;
      }
      const exitReason = controlProcess.exitCode !== null
        ? `exit code ${controlProcess.exitCode}`
        : `signal ${controlProcess.signalCode}`;
      throw readinessFailure(`Remote Redeven launcher failed before reporting readiness (${exitReason}).`, args.logs);
    }

    if (Date.now() >= deadline) {
      throw readinessFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.logs);
    }
    await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
  }
}

type ManagedSSHRuntimeAttachPolicy =
  | Readonly<{ action: 'reuse' }>
  | Readonly<{ action: 'replace'; message: string }>
  | Readonly<{ action: 'block'; message: string; maintenance: DesktopRuntimeMaintenanceRequirement }>;

function startupReportsStoppablePID(startup: StartupReport): boolean {
  const pid = Number(startup.pid ?? Number.NaN);
  return Number.isInteger(pid) && pid > 0;
}

function managedSSHRuntimeAttachPolicy(
  startup: StartupReport,
  args: Readonly<{
    expectedRuntimeIdentity: RuntimeServiceIdentity;
    requireDesktopAIBrokerBinding: boolean;
    allowActiveWorkReplacement: boolean;
  }>,
): ManagedSSHRuntimeAttachPolicy {
  const runtimeService = startup.runtime_service;
  const identityMismatch = !runtimeServiceMatchesIdentity(runtimeService, args.expectedRuntimeIdentity);
  const needsRuntimeUpdate = runtimeServiceNeedsRuntimeUpdate(runtimeService);
  const brokerBindingUnsupported = args.requireDesktopAIBrokerBinding
    && !runtimeServiceSupportsDesktopAIBrokerBinding(runtimeService);

  if (!identityMismatch && !needsRuntimeUpdate && !brokerBindingUnsupported) {
    return { action: 'reuse' };
  }

  const maintenanceKind = brokerBindingUnsupported
    ? 'desktop_model_source_requires_runtime_update'
    : needsRuntimeUpdate
      ? 'ssh_runtime_update_required'
      : 'ssh_runtime_restart_required';
  const maintenance: DesktopRuntimeMaintenanceRequirement = {
    kind: maintenanceKind,
    required_for: brokerBindingUnsupported ? 'desktop_model_source' : 'open',
    can_desktop_restart: startupReportsStoppablePID(startup),
    has_active_work: runtimeServiceHasActiveWork(runtimeService),
    active_work_label: formatRuntimeServiceWorkload(runtimeService),
    current_runtime_version: runtimeService?.runtime_version,
    target_runtime_version: args.expectedRuntimeIdentity.runtime_version,
    message: brokerBindingUnsupported
      ? 'Update and restart this SSH runtime before Desktop can make your local model settings available here.'
      : needsRuntimeUpdate
        ? 'Update and restart this SSH runtime before opening this environment.'
        : 'Restart this SSH runtime before opening this environment.',
  };

  if (runtimeServiceHasActiveWork(runtimeService) && !args.allowActiveWorkReplacement) {
    return {
      action: 'block',
      message: brokerBindingUnsupported
        ? 'This SSH runtime needs to update before Desktop can prepare the Desktop model source, but active work is still running.'
        : 'This SSH runtime needs to restart before Desktop can open it, but active work is still running.',
      maintenance,
    };
  }
  if (!startupReportsStoppablePID(startup)) {
    return {
      action: 'block',
      message: brokerBindingUnsupported
        ? 'This SSH runtime needs to update before Desktop can prepare the Desktop model source, but it did not report a process id Desktop can stop.'
        : 'This SSH runtime needs to restart before Desktop can open it, but it did not report a process id Desktop can stop.',
      maintenance,
    };
  }
  return {
    action: 'replace',
    message: brokerBindingUnsupported
      ? 'Restarting SSH runtime so Desktop can prepare the Desktop model source.'
      : 'Restarting SSH runtime so Desktop can open the requested runtime version.',
  };
}

type RuntimeDesktopAIBrokerBindResponse = Readonly<{
  ok?: boolean;
  error?: string;
  data?: Readonly<{
    ai_runtime?: Readonly<{
      desktop_broker?: Readonly<{
        binding_state?: string;
        connected?: boolean;
        last_error?: string;
      }> | null;
    }> | null;
  }>;
}>;

async function postJSONToForwardedLocalUI<T>(
  baseURL: string,
  pathName: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfSSHRuntimeCanceled(signal);
  const url = new URL(pathName, baseURL);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.trim() !== '') {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const message = compact(record.error) || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (isAbortError(error) && signal?.aborted) {
      throw new DesktopSSHRuntimeCanceledError();
    }
    if (isAbortError(error) && timedOut) {
      throw new Error('Timed out waiting for Runtime Control to bind the Desktop AI Broker.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function bindDesktopAIBrokerToForwardedRuntime(args: Readonly<{
  forwardedURL: string;
  remoteBrokerURL: string;
  broker: ManagedSSHRuntimeAIBroker;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<void> {
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_binding_ai_broker',
    'Preparing Desktop model source',
    'Desktop is making your local model settings available to the SSH runtime.',
  );
  const payload = await postJSONToForwardedLocalUI<RuntimeDesktopAIBrokerBindResponse>(
    args.forwardedURL,
    '/_redeven_proxy/api/runtime/bindings/desktop-ai-broker',
    {
      url: args.remoteBrokerURL,
      token: args.broker.token,
      session_id: args.broker.session_id,
      ssh_runtime_key: args.broker.ssh_runtime_key,
      expires_at_unix_ms: args.broker.expires_at_unix_ms,
      model_source: 'desktop_local_environment',
    },
    args.timeoutMs,
    args.signal,
  );
  if (!payload?.ok) {
    throw new Error(compact(payload?.error) || 'Runtime Control did not accept the Desktop AI Broker binding.');
  }
  const status = payload.data?.ai_runtime?.desktop_broker ?? null;
  if (!status?.connected || compact(status.binding_state) !== 'bound') {
    throw new Error(compact(status?.last_error) || 'Runtime Control did not bind the Desktop AI Broker.');
  }
}

export async function startManagedSSHRuntime(args: StartManagedSSHRuntimeArgs): Promise<ManagedSSHRuntime> {
  throwIfSSHRuntimeCanceled(args.signal);
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
    reverse_forward_stderr: '',
    forward_stderr: '',
  };

  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'rdv-ssh-'));
  const controlSocketPath = path.join(tempDir, 'm.sock');
  const sessionToken = randomBytes(8).toString('hex');
  const auth: SSHCommandAuthContext = {
    mode: target.auth_mode,
    askPassScriptPath: await createSSHAskPassScript(tempDir, target.auth_mode),
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
  let reverseForwardProcess: SpawnedSSHProcess | null = null;
  let forwardProcess: SpawnedSSHProcess | null = null;
  let remoteBrokerURL = '';
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
    await stopChildProcess(reverseForwardProcess, stopTimeoutMs).catch(() => undefined);
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

    if (args.aiBroker) {
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_opening_tunnel',
        'Preparing Desktop model source',
        'Desktop is creating a private SSH bridge for local model calls.',
      );
      try {
        const reverse = await openDesktopAIBrokerReverseForward({
          sshBinary,
          target,
          controlSocketPath,
          connectTimeoutSeconds,
          auth,
          broker: args.aiBroker,
          startupTimeoutMs,
          logs,
          onLog: args.onLog,
          signal: args.signal,
        });
        reverseForwardProcess = reverse.process;
        remoteBrokerURL = reverse.remoteURL;
      } catch (error) {
        if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        args.onLog?.('reverse_forward_stderr', `Desktop model bridge unavailable: ${message}\n`);
      }
    }

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
          target.remote_install_dir,
          runtimeReleaseTag,
          sessionToken,
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
        requireDesktopAIBrokerBinding: !!args.aiBroker,
        allowActiveWorkReplacement: args.forceRuntimeUpdate === true,
      });
      if (attachPolicy.action === 'block') {
        throw new DesktopSSHRuntimeMaintenanceRequiredError(
          attachPolicy.message,
          attachPolicy.maintenance,
          formatRecentLogs(logs),
        );
      }
      if (attachPolicy.action === 'reuse') {
        remoteLaunch = launch;
        break;
      }
      if (replacementAttempted) {
        throw readinessFailure('Desktop restarted the SSH runtime, but the running Runtime Service still does not match this session.', logs);
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
      throw readinessFailure('Desktop could not resolve the final SSH Runtime Service startup report.', logs);
    }
    const remoteStartup = remoteLaunch.startup;
    remoteRuntimePID = remoteStartup.pid ?? null;

    const localPort = await allocateLocalForwardPort();
    const remotePort = remotePortFromStartup(remoteStartup);
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

    const forwardedURL = localForwardURL(localPort);
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
      throw readinessFailure('Desktop created the SSH port forward but could not reach the forwarded Redeven Local UI.', logs);
    }
    if (args.aiBroker) {
      if (remoteBrokerURL) {
        try {
          await bindDesktopAIBrokerToForwardedRuntime({
            forwardedURL,
            remoteBrokerURL,
            broker: args.aiBroker,
            timeoutMs: args.probeTimeoutMs ?? startupTimeoutMs,
            signal: args.signal,
            onProgress: args.onProgress,
          });
        } catch (error) {
          if (error instanceof DesktopSSHRuntimeCanceledError || isAbortError(error) || args.signal?.aborted) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          args.onLog?.('control_stderr', `Desktop model bridge unavailable: ${message}\n`);
        } finally {
          forwardedStartup = await waitForForwardedLocalUIOpenable(
            forwardedURL,
            args.probeTimeoutMs ?? startupTimeoutMs,
            args.signal,
          ) ?? forwardedStartup;
        }
      }
    }
    const startup: StartupReport = {
      ...remoteStartup,
      local_ui_url: forwardedStartup.local_ui_url,
      local_ui_urls: forwardedStartup.local_ui_urls,
      password_required: forwardedStartup.password_required,
      runtime_service: forwardedStartup.runtime_service ?? remoteStartup.runtime_service,
    };
    return {
      startup,
      local_forward_url: forwardedURL,
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
