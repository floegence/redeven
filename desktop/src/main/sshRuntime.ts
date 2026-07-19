import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
  type DesktopSSHReleaseFetchPolicy,
} from './sshReleaseAssets';
import {
  prepareDesktopRuntimeUploadAsset,
  runtimeReleaseFetchPolicy,
  type DesktopRuntimeUploadAsset,
} from './runtimePackageCache';
import {
  parseDesktopRuntimeProcessInventory,
  parseDesktopRuntimeProcessStopResult,
  requireDesktopRuntimeProcessReconciliation,
  desktopRuntimeProcessInventoryHasSingleCurrentOwner,
  desktopRuntimeProcessStopTargetCount,
  runtimeProcessCommandErrorFromOutput,
  type DesktopRuntimeProcessInventory,
  type DesktopRuntimeProcessStopResult,
} from './runtimeProcessInventory';
import type { DesktopRuntimeProcessReconciliation } from '../shared/desktopRuntimeProcessTakeover';
import type { DesktopSessionRuntimeHandle, DesktopSessionRuntimeLaunchMode } from './sessionRuntime';
import type { StartupReport } from './startup';
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
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  formatRuntimeServiceWorkload,
  runtimeServiceHasActiveWork,
  runtimeServiceMatchesIdentity,
  type RuntimeServiceIdentity,
} from '../shared/runtimeService';
import {
  buildDesktopRuntimeMaintenanceRequirement,
  classifyDesktopRuntimeBlockedLaunchReport,
  desktopRuntimeMaintenanceIsLiveManagementSocketUnreachable,
  type DesktopRuntimeMaintenanceRequirement,
} from '../shared/desktopRuntimeHealth';
import type {
  DesktopOperationFailurePresentation,
} from '../shared/desktopOperationFailure';
import type { DesktopTranslationKey } from '../shared/i18n';
import {
  DesktopSSHTransportInterruptedError,
  DesktopSSHTransportUnavailableError,
  type DesktopSSHStreamingCommand,
  type DesktopSSHTransportLease,
  type DesktopSSHTransportManager,
} from './sshTransportManager';

const PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';
const DEFAULT_SSH_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_SSH_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_SSH_POLL_INTERVAL_MS = 200;
const MAX_RECENT_LOG_CHARS = 8_000;
export const MANAGED_SSH_RUNTIME_STAMP_FILENAME = 'managed-runtime.stamp';
export const MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION = 2;

type RemoteInstallStrategy = 'desktop_upload' | 'remote_install';
type PreparedDesktopSSHUploadAsset = DesktopRuntimeUploadAsset;
type PreparedManagedSSHRuntimePackage = Readonly<{
  stagingRoot: string;
  installStrategy: RemoteInstallStrategy;
}>;
type SSHControlSessionContext = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  lease: DesktopSSHTransportLease;
  logs: MutableRecentLogs;
  onLog: StartManagedSSHRuntimeArgs['onLog'];
  signal?: AbortSignal;
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
export type ManagedSSHRuntimeProcessInventoryArgs = Readonly<{
  sshTransportManager: DesktopSSHTransportManager;
  sshCredentialScope: string;
  transportLease?: DesktopSSHTransportLease;
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  desktopOwnerID: string;
  runtimeStateRoot?: string;
  sshPassword?: string;
  sshBinary?: string;
  tempRoot?: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  runtimeProcessReconciliation?: DesktopRuntimeProcessReconciliation;
  connectTimeoutSeconds?: number;
  signal?: AbortSignal;
  onLog?: StartManagedSSHRuntimeArgs['onLog'];
  onProgress?: StartManagedSSHRuntimeArgs['onProgress'];
}>;
export type DesktopSSHRemoteRuntimeStamp = Readonly<{
  schema_version: typeof MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION;
  managed_by: 'redeven-desktop';
  slot_release_tag: string;
  install_strategy: RemoteInstallStrategy;
}>;
export type DesktopSSHRemoteRuntimeProbeStatus =
  | 'ready'
  | 'missing_binary'
  | 'binary_not_executable'
  | 'version_command_failed'
  | 'version_output_invalid'
  | 'slot_version_mismatch'
  | 'stamp_missing'
  | 'stamp_invalid';
export type DesktopSSHRemoteRuntimeProbeResult = Readonly<{
  status: DesktopSSHRemoteRuntimeProbeStatus;
  slot_release_tag: string | null;
  reported_release_tag: string | null;
  target_release_tag: string | null;
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
  | 'ssh_discovering_runtime_instances'
  | 'ssh_stopping_runtime_process'
  | 'ssh_verifying_runtime_inventory'
  | 'ssh_activating_runtime_package'
  | 'ssh_starting_runtime'
  | 'ssh_waiting_report'
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
}>;

type MutableRecentLogs = {
  master_stderr: string;
  control_stdout: string;
  control_stderr: string;
};

type SSHCommandResult = Readonly<{
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

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

export type ManagedSSHRuntimeReady = Readonly<{
  startup: StartupReport;
  runtime_handle: DesktopSessionRuntimeHandle;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

type ManagedSSHRemoteStartup = Readonly<{
  startup: StartupReport;
  launch_mode: DesktopSessionRuntimeLaunchMode;
}>;

export type StartManagedSSHRuntimeArgs = Readonly<{
  sshTransportManager: DesktopSSHTransportManager;
  sshCredentialScope: string;
  target: DesktopSSHEnvironmentDetails;
  runtimeReleaseTag: string;
  desktopOwnerID: string;
  runtimeStateRoot?: string;
  sshPassword?: string;
  sshBinary?: string;
  installScriptURL?: string;
  sourceRuntimeRoot?: string;
  tempRoot?: string;
  assetCacheRoot?: string;
  forceRuntimeUpdate?: boolean;
  runtimeProcessIntent?: 'start' | 'restart' | 'update';
  runtimeProcessReconciliation?: DesktopRuntimeProcessReconciliation;
  allowActiveWorkReplacement?: boolean;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  signal?: AbortSignal;
  beforeRuntimeReplacement?: () => Promise<void>;
  onLog?: (
    stream:
      | 'master_stderr'
      | 'control_stdout'
      | 'control_stderr',
    chunk: string,
  ) => void;
  onProgress?: (progress: DesktopSSHRuntimeProgress) => void;
}>;

type ManagedRuntimePackageIntent = 'use_installed' | 'install_if_missing' | 'replace_with_desktop_target';

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

function createMutableRecentLogs(): MutableRecentLogs {
  return {
    master_stderr: '',
    control_stdout: '',
    control_stderr: '',
  };
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
};

function readinessFailure(
  message: string,
  logs: RecentLogs,
  options: Readonly<{
    code?: DesktopOperationFailurePresentation['code'];
    title?: string;
    titleKey?: DesktopTranslationKey;
    summary?: string;
    summaryKey?: DesktopTranslationKey;
    detail?: string;
    detailKey?: DesktopTranslationKey;
    recoveryHint?: string;
    recoveryHintKey?: DesktopTranslationKey;
    targetLabel?: string;
  }> = {},
): Error {
  return new DesktopOperationFailureError(desktopOperationFailurePresentation({
    code: options.code ?? 'ssh_runtime_launch_failed',
    title: options.title ?? 'SSH Runtime Start Failed',
    titleKey: options.titleKey,
    summary: compact(options.summary) || message,
    summaryKey: options.summaryKey,
    detail: options.detail,
    detailKey: options.detailKey,
    recoveryHint: options.recoveryHint,
    recoveryHintKey: options.recoveryHintKey,
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
    'case "$runtime_root" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "remote HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    runtime_root="\${HOME%/}/.redeven/\${runtime_root#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
  ].join('\n');
}

function buildRemoteStateRootShell(): string {
  return [
    'state_root_raw="${2:-}"',
    'if [ -z "$state_root_raw" ]; then',
    '  state_root_raw="$runtime_root_raw"',
    'fi',
    `if [ "$state_root_raw" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "remote HOME is unavailable; set Runtime State Root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    '  state_root="${HOME%/}/.redeven"',
    'else',
    '  state_root="$state_root_raw"',
    'fi',
    'case "$state_root" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "remote HOME is unavailable; set Runtime State Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    state_root="\${HOME%/}/.redeven/\${state_root#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
  ].join('\n');
}

function buildManagedSSHRuntimePathShell(targetReleaseTagArg = '2'): string {
  return [
    `target_release_tag="\${${targetReleaseTagArg}:-}"`,
    'managed_root="${runtime_root%/}/runtime/managed"',
    'bin_dir="${managed_root}/bin"',
    'binary="${bin_dir}/redeven"',
    `stamp_path="\${managed_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
  ].join('\n');
}

function buildManagedSSHRuntimeProbeShell(): string {
  return [
    'probe_status=""',
    'probe_reason=""',
    'slot_release_tag=""',
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
    '  slot_release_tag=""',
    '  while IFS= read -r stamp_line; do',
    '    case "$stamp_line" in',
    '      slot_release_tag=*) slot_release_tag="${stamp_line#slot_release_tag=}" ;;',
    '    esac',
    '  done < "$stamp_path"',
    '  case "$slot_release_tag" in',
    '    "")',
    '      probe_status="stamp_invalid"',
    '      probe_reason="managed runtime stamp release is missing"',
    '      return 1',
    '      ;;',
    '    v*) ;;',
    '    *) slot_release_tag="v$slot_release_tag" ;;',
    '  esac',
    '  if [ "$slot_release_tag" != "$reported_release_tag" ]; then',
    '    probe_status="slot_version_mismatch"',
    '    probe_reason="managed runtime stamp release does not match the installed binary"',
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
    '  slot_release_tag="$2"',
    '  mkdir -p "$managed_root"',
    '  temp_stamp="${stamp_path}.tmp.$$"',
    '  {',
    `    printf 'schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}\\n'`,
    "    printf 'managed_by=redeven-desktop\\n'",
    "    printf 'slot_release_tag=%s\\n' \"$slot_release_tag\"",
    "    printf 'install_strategy=%s\\n' \"$install_strategy\"",
    "    printf 'installed_at_unix_ms=%s\\n' \"$(date +%s)000\"",
    '  } > "$temp_stamp"',
    '  mv "$temp_stamp" "$stamp_path"',
    '}',
  ].join('\n');
}

function buildManagedSSHRuntimeSwitchShell(): string {
  return [
    'switch_staged_runtime() {',
    '  staged_binary="${staging_root}/bin/redeven"',
    `  staged_stamp="\${staging_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
    '  if [ ! -x "$staged_binary" ]; then',
    '    echo "staged Redeven binary is missing" >&2',
    '    return 1',
    '  fi',
    '  if [ ! -f "$staged_stamp" ]; then',
    '    echo "staged Redeven stamp is missing" >&2',
    '    return 1',
    '  fi',
    '  mkdir -p "$(dirname "$managed_root")"',
    '  previous_managed_root="${managed_root}.previous.$$"',
    '  rm -rf "$previous_managed_root"',
    '  if [ -e "$managed_root" ]; then',
    '    mv "$managed_root" "$previous_managed_root"',
    '  fi',
    '  if mv "$staging_root" "$managed_root"; then',
    '    rm -rf "$previous_managed_root"',
    '    return 0',
    '  fi',
    '  if [ -e "$previous_managed_root" ]; then',
    '    mv "$previous_managed_root" "$managed_root" || true',
    '  fi',
    '  return 1',
    '}',
  ].join('\n');
}

export function buildManagedSSHRuntimeProbeScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    buildManagedSSHRuntimeStampShell(),
    buildManagedSSHRuntimeProbeShell(),
    'runtime_is_compatible || true',
    "printf 'status=%s\\n' \"$probe_status\"",
    "printf 'slot_release_tag=%s\\n' \"$slot_release_tag\"",
    "printf 'reported_release_tag=%s\\n' \"$reported_release_tag\"",
    "printf 'target_release_tag=%s\\n' \"$target_release_tag\"",
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
    buildManagedSSHRuntimeStampShell(),
    'if [ -z "$target_release_tag" ]; then',
    '  echo "target release tag is required for remote runtime install" >&2',
    '  exit 1',
    'fi',
    'mkdir -p "${runtime_root%/}/runtime"',
    'staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"',
    'cleanup_staging=1',
    'cleanup() {',
    '  if [ "$cleanup_staging" = "1" ]; then rm -rf "$staging_root"; fi',
    '}',
    'trap cleanup EXIT INT TERM',
    'staging_bin_dir="${staging_root}/bin"',
    'script_path="${staging_root}/install.sh"',
    'mkdir -p "$staging_bin_dir"',
    'curl -fsSL "$install_script_url" -o "$script_path"',
    'REDEVEN_INSTALL_MODE=upgrade REDEVEN_VERSION="$target_release_tag" REDEVEN_INSTALL_DIR="$staging_bin_dir" sh "$script_path"',
    'old_stamp_path="$stamp_path"',
    'old_managed_root="$managed_root"',
    'managed_root="$staging_root"',
    `  stamp_path="\${managed_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
    'write_runtime_stamp "remote_install" "$target_release_tag"',
    'managed_root="$old_managed_root"',
    'stamp_path="$old_stamp_path"',
    'staged_binary="${staging_bin_dir}/redeven"',
    'if [ ! -x "$staged_binary" ]; then',
    '  echo "installed Redeven binary is missing from staging" >&2',
    '  exit 1',
    'fi',
    'if ! staged_version_output="$("$staged_binary" version 2>/dev/null)"; then',
    '  echo "staged Redeven binary failed to report its version" >&2',
    '  exit 1',
    'fi',
    'set -- $staged_version_output',
    'staged_release_tag="${2:-}"',
    'case "$staged_release_tag" in v*) ;; *) staged_release_tag="v$staged_release_tag" ;; esac',
    'if [ "$staged_release_tag" != "$target_release_tag" ]; then',
    '  echo "staged Redeven binary reported $staged_release_tag instead of $target_release_tag" >&2',
    '  exit 1',
    'fi',
    'rm -f "$script_path"',
    'cleanup_staging=0',
    'trap - EXIT INT TERM',
    'printf "%s\\n" "$staging_root"',
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
    'if [ -z "$target_release_tag" ]; then',
    '  echo "target release tag is required for uploaded runtime install" >&2',
    '  exit 1',
    'fi',
    'mkdir -p "${runtime_root%/}/runtime"',
    'staging_root="$(mktemp -d "${managed_root}.staging.XXXXXX")"',
    'extract_dir="$(mktemp -d "${upload_dir%/}/extract.XXXXXX")"',
    'cleanup_staging=1',
    'cleanup() {',
    '  rm -rf "$extract_dir" "$upload_dir"',
    '  if [ "$cleanup_staging" = "1" ]; then rm -rf "$staging_root"; fi',
    '}',
    'trap cleanup EXIT INT TERM',
    'mkdir -p "${staging_root}/bin"',
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
    'mv "$binary_path" "${staging_root}/bin/redeven"',
    'chmod +x "${staging_root}/bin/redeven"',
    'if ! staged_version_output="$("${staging_root}/bin/redeven" version 2>/dev/null)"; then',
    '  echo "uploaded Redeven binary failed to report its version" >&2',
    '  exit 1',
    'fi',
    'set -- $staged_version_output',
    'staged_release_tag="${2:-}"',
    'case "$staged_release_tag" in v*) ;; *) staged_release_tag="v$staged_release_tag" ;; esac',
    'if [ "$staged_release_tag" != "$target_release_tag" ]; then',
    '  echo "uploaded Redeven binary reported $staged_release_tag instead of $target_release_tag" >&2',
    '  exit 1',
    'fi',
    'old_stamp_path="$stamp_path"',
    'old_managed_root="$managed_root"',
    'managed_root="$staging_root"',
    `stamp_path="\${managed_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
    'write_runtime_stamp "desktop_upload" "$target_release_tag"',
    'managed_root="$old_managed_root"',
    'stamp_path="$old_stamp_path"',
    'cleanup_staging=0',
    'printf "%s\\n" "$staging_root"',
  ].join('\n');
}

export function buildManagedSSHActivatePreparedRuntimeScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildManagedSSHRuntimePathShell(),
    'staging_root="$3"',
    'case "$staging_root" in',
    '  "${managed_root}.staging."*) ;;',
    '  *) echo "prepared runtime path is outside the managed staging layout" >&2; exit 1 ;;',
    'esac',
    'staged_binary="${staging_root}/bin/redeven"',
    `staged_stamp="\${staging_root}/${MANAGED_SSH_RUNTIME_STAMP_FILENAME}"`,
    'if [ ! -x "$staged_binary" ] || [ ! -f "$staged_stamp" ]; then',
    '  echo "prepared runtime package is incomplete" >&2',
    '  exit 1',
    'fi',
    `grep -Fx "schema_version=${MANAGED_SSH_RUNTIME_STAMP_SCHEMA_VERSION}" "$staged_stamp" >/dev/null`,
    'grep -Fx "managed_by=redeven-desktop" "$staged_stamp" >/dev/null',
    'grep -Fx "slot_release_tag=$target_release_tag" "$staged_stamp" >/dev/null',
    'if ! staged_version_output="$("$staged_binary" version 2>/dev/null)"; then',
    '  echo "prepared Redeven binary failed to report its version" >&2',
    '  exit 1',
    'fi',
    'set -- $staged_version_output',
    'staged_release_tag="${2:-}"',
    'case "$staged_release_tag" in v*) ;; *) staged_release_tag="v$staged_release_tag" ;; esac',
    'if [ "$staged_release_tag" != "$target_release_tag" ]; then',
    '  echo "prepared Redeven binary version changed before activation" >&2',
    '  exit 1',
    'fi',
    buildManagedSSHRuntimeSwitchShell(),
    'switch_staged_runtime',
  ].join('\n');
}

export function buildManagedSSHStartScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildRemoteStateRootShell(),
    buildManagedSSHRuntimePathShell('3'),
    'session_token="$4"',
    'desktop_owner_id="${5:-}"',
    'session_dir="${state_root%/}/runtime/sessions/${session_token}"',
    'report_path="${session_dir}/startup-report.json"',
    'log_dir="${state_root%/}/runtime/logs"',
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
    buildRemoteStateRootShell(),
    'session_token="$3"',
    'report_path="${state_root%/}/runtime/sessions/${session_token}/startup-report.json"',
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
    buildRemoteStateRootShell(),
    buildManagedSSHRuntimePathShell('3'),
    'if [ ! -x "$binary" ]; then',
    '  exit 127',
    'fi',
    'exec "$binary" desktop-runtime-status --state-root "$state_root"',
  ].join('\n');
}

function buildManagedSSHRuntimeProcessHelperScript(): string {
  return [
    'set -eu',
    buildRemoteInstallRootShell(),
    buildRemoteStateRootShell(),
    'operation="${3:-}"',
    'desktop_owner_id="${4:-}"',
    'inventory_digest="${5:-}"',
    'grace_period="${6:-5s}"',
    'reconciliation_mode="${7:-automatic}"',
    'maintenance_root="${runtime_root%/}/runtime/maintenance"',
    'mkdir -p "$maintenance_root"',
    'helper_root="$(mktemp -d "${maintenance_root%/}/process-helper.XXXXXX")"',
    'archive_path="${helper_root}/runtime.tar.gz"',
    'cleanup() { rm -rf "$helper_root"; }',
    'trap cleanup EXIT INT TERM',
    'cat > "$archive_path"',
    'tar -xzf "$archive_path" -C "$helper_root"',
    'binary="${helper_root}/redeven"',
    'managed_binary="${runtime_root%/}/runtime/managed/bin/redeven"',
    'if [ ! -x "$binary" ]; then',
    '  echo "Desktop runtime process helper is missing redeven" >&2',
    '  exit 1',
    'fi',
    'case "$operation" in',
    '  inventory)',
    '    "$binary" desktop-runtime-inventory --runtime-root "$runtime_root" --state-root "$state_root" --desktop-owner-id "$desktop_owner_id" --current-executable "$managed_binary"',
    '    ;;',
    '  stop)',
    '    "$binary" desktop-runtime-stop --runtime-root "$runtime_root" --state-root "$state_root" --desktop-owner-id "$desktop_owner_id" --current-executable "$managed_binary" --reconciliation-mode "$reconciliation_mode" --all-matching --expected-inventory-digest "$inventory_digest" --grace-period "$grace_period" --json',
    '    ;;',
    '  *)',
    '    echo "runtime helper operation is invalid" >&2',
    '    exit 2',
    '    ;;',
    'esac',
  ].join('\n');
}

export async function probeManagedSSHRuntimeStatus(
  args: Readonly<{
    sshTransportManager: DesktopSSHTransportManager;
    sshCredentialScope: string;
    target: DesktopSSHEnvironmentDetails;
    runtimeReleaseTag: string;
    runtimeStateRoot?: string;
    sshPassword?: string;
    sshBinary?: string;
    tempRoot?: string;
    connectTimeoutSeconds?: number;
    signal?: AbortSignal;
  }>,
): Promise<DesktopSSHRuntimeStatusProbe> {
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const logs = createMutableRecentLogs();
  let lease: DesktopSSHTransportLease | null = null;
  try {
    lease = await args.sshTransportManager.acquire({
      target,
      credentialScope: args.sshCredentialScope,
      sshPassword: args.sshPassword,
      sshBinary: args.sshBinary,
      readyTimeoutMs: Math.max(1_000, (args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS) * 1_000),
      signal: args.signal,
    });
    const session: SSHControlSessionContext = {
      target,
      lease,
      logs,
      onLog: undefined,
      signal: args.signal,
    };
    const result = await runSSHControlCommand(
      session,
      remoteShellCommand(buildManagedSSHRuntimeStatusScript(), 'redeven-ssh-runtime-status', [
        target.runtime_root,
        args.runtimeStateRoot ?? target.runtime_root,
        runtimeReleaseTag,
      ]),
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
    if (error instanceof DesktopSSHTransportUnavailableError) {
      appendSSHRuntimeLog(logs, 'master_stderr', error.stderr, undefined);
      const targetLabel = desktopSSHAuthority(target);
      const failure = desktopOperationFailurePresentation({
        code: 'ssh_connection_failed',
        title: 'SSH Connection Failed',
        summary: `SSH connection to "${targetLabel}" failed.`,
        detail: 'Desktop could not verify the Redeven runtime status on this SSH host.',
        recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
        targetLabel,
        diagnostics: diagnosticsFromRecentLogs(logs, SSH_RECENT_LOG_LABELS),
      });
      return { status: 'failed', message: failure.summary, failure };
    }
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
    await lease?.release();
  }
}

async function runManagedSSHRuntimeProcessCommand(
  args: ManagedSSHRuntimeProcessInventoryArgs,
  operation: 'inventory' | 'stop',
  inventoryDigest = '',
  gracePeriodMs = DEFAULT_SSH_STOP_TIMEOUT_MS,
): Promise<string> {
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const desktopOwnerID = compact(args.desktopOwnerID);
  if (!desktopOwnerID) {
    throw new Error('Desktop owner id is required for runtime process reconciliation.');
  }
  const logs = createMutableRecentLogs();
  let ownedLease: DesktopSSHTransportLease | null = null;
  const lease = args.transportLease ?? await args.sshTransportManager.acquire({
    target,
    credentialScope: args.sshCredentialScope,
    sshPassword: args.sshPassword,
    sshBinary: args.sshBinary,
    readyTimeoutMs: Math.max(1_000, (args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS) * 1_000),
    signal: args.signal,
  });
  if (!args.transportLease) {
    ownedLease = lease;
  }
  const session: SSHControlSessionContext = {
    target,
    lease,
    logs,
    onLog: args.onLog,
    signal: args.signal,
  };
  try {
    const platformResult = await runSSHControlCommand(
      session,
      remoteShellCommand('set -eu\nuname -s\nuname -m', 'redeven-ssh-runtime-helper-platform'),
    );
    if (platformResult.exit_code !== 0) {
      throw runtimeProcessCommandErrorFromOutput(
        platformResult.stdout,
        platformResult.stderr,
        'Desktop could not detect the SSH host platform for runtime reconciliation.',
      );
    }
    const platformLines = platformResult.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (platformLines.length < 2) {
      throw new Error('Desktop received an incomplete SSH host platform result for runtime reconciliation.');
    }
    const platform = resolveDesktopSSHRemotePlatform(platformLines[0] ?? '', platformLines[1] ?? '');
    const asset = await prepareDesktopRuntimeUploadAsset({
      runtimeReleaseTag,
      releaseBaseURL: target.release_base_url,
      assetCacheRoot: args.assetCacheRoot,
      sourceRuntimeRoot: args.sourceRuntimeRoot,
      platform,
      fetchPolicy: runtimeReleaseFetchPolicy(DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS, args.signal),
      signal: args.signal,
    });
    const helperResult = await runSSHControlCommand(
      session,
      remoteShellCommand(buildManagedSSHRuntimeProcessHelperScript(), 'redeven-ssh-runtime-process-helper', [
        target.runtime_root,
        args.runtimeStateRoot ?? target.runtime_root,
        operation,
        desktopOwnerID,
        inventoryDigest,
        `${Math.max(1, Math.ceil(gracePeriodMs / 1000))}s`,
        args.runtimeProcessReconciliation?.mode ?? 'automatic',
      ]),
      asset.archiveData,
    );
    if (helperResult.exit_code !== 0) {
      throw runtimeProcessCommandErrorFromOutput(
        helperResult.stdout,
        helperResult.stderr,
        `Desktop runtime process helper could not ${operation === 'inventory' ? 'inspect' : 'stop'} the SSH runtime processes.`,
      );
    }
    return helperResult.stdout;
  } finally {
    await ownedLease?.release();
  }
}

export async function inspectManagedSSHRuntimeProcesses(
  args: ManagedSSHRuntimeProcessInventoryArgs,
): Promise<DesktopRuntimeProcessInventory> {
  return parseDesktopRuntimeProcessInventory(await runManagedSSHRuntimeProcessCommand(args, 'inventory'));
}

export async function stopManagedSSHRuntimeProcesses(
  args: ManagedSSHRuntimeProcessInventoryArgs,
  inventory: DesktopRuntimeProcessInventory,
  gracePeriodMs = DEFAULT_SSH_STOP_TIMEOUT_MS,
): Promise<DesktopRuntimeProcessStopResult> {
  return parseDesktopRuntimeProcessStopResult(await runManagedSSHRuntimeProcessCommand(
    { ...args, signal: undefined },
    'stop',
    inventory.inventory_digest,
    gracePeriodMs,
  ));
}

function probeResultFallbackReason(status: DesktopSSHRemoteRuntimeProbeStatus): string {
  switch (status) {
    case 'ready':
      return 'desktop-managed runtime slot is ready';
    case 'missing_binary':
      return 'managed runtime binary is missing';
    case 'binary_not_executable':
      return 'managed runtime binary is not executable';
    case 'version_command_failed':
      return 'managed runtime failed to report its version';
    case 'version_output_invalid':
      return 'managed runtime returned an invalid version string';
    case 'slot_version_mismatch':
      return 'managed runtime stamp release does not match the installed binary';
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
    case 'slot_version_mismatch':
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

function normalizeOptionalRuntimeReleaseTag(raw: string | undefined): string | null {
  const clean = compact(raw);
  return clean === '' ? null : normalizeRuntimeReleaseTag(clean);
}

export function parseManagedSSHRuntimeProbeResult(raw: string): DesktopSSHRemoteRuntimeProbeResult {
  const values = parseProbeResultLines(raw);
  const status = normalizeProbeStatus(values.get('status') ?? '');
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
    slot_release_tag: normalizeOptionalRuntimeReleaseTag(values.get('slot_release_tag')),
    reported_release_tag: normalizeOptionalRuntimeReleaseTag(values.get('reported_release_tag')),
    target_release_tag: normalizeOptionalRuntimeReleaseTag(values.get('target_release_tag')),
    binary_path: binaryPath,
    stamp_path: stampPath,
    reason: compact(values.get('reason')) || probeResultFallbackReason(status),
  };
}

export function describeManagedSSHRuntimeProbeResult(result: DesktopSSHRemoteRuntimeProbeResult): string {
  switch (result.status) {
    case 'ready':
      return `Desktop-managed runtime at ${result.binary_path} is ready (${result.reported_release_tag ?? result.slot_release_tag ?? 'unknown version'}).`;
    case 'slot_version_mismatch':
      return `Managed runtime at ${result.binary_path} reports ${result.reported_release_tag ?? 'an unknown version'}, but its Desktop stamp records ${result.slot_release_tag ?? 'an unknown version'}.`;
    case 'stamp_missing':
      return `Managed runtime stamp is missing at ${result.stamp_path}.`;
    case 'stamp_invalid':
      return `Managed runtime stamp at ${result.stamp_path} is invalid.`;
    default:
      return `${result.reason} (${result.binary_path}).`;
  }
}

function appendSSHRuntimeLog(
  logs: MutableRecentLogs,
  key: keyof MutableRecentLogs,
  chunk: string,
  onLog?: StartManagedSSHRuntimeArgs['onLog'],
): void {
  if (compact(chunk) === '') {
    return;
  }
  logs[key] = appendRecentLog(logs[key], chunk);
  onLog?.(key, chunk);
}

function recordSSHControlCheckFailure(
  session: SSHControlSessionContext,
  error: DesktopSSHTransportInterruptedError,
): void {
  const checkEvidence = compact(error.checkResult?.stderr)
    || compact(error.checkResult?.stdout)
    || 'SSH control check did not complete.';
  const chunk = `[ssh -O check]\n${checkEvidence}\n`;
  appendSSHRuntimeLog(session.logs, 'master_stderr', chunk, session.onLog);
}

function sshConnectionInterruptedFailure(session: SSHControlSessionContext): Error {
  const targetLabel = desktopSSHAuthority(session.target);
  return readinessFailure(
    `Desktop connected to "${targetLabel}", but the reusable SSH connection ended before the operation completed.`,
    session.logs,
    {
      code: 'ssh_connection_interrupted',
      title: 'SSH Connection Interrupted',
      titleKey: 'progress.sshConnectionInterruptedTitle',
      summaryKey: 'progress.sshConnectionInterruptedSummary',
      detail: 'The SSH control connection was no longer healthy after a remote command failed.',
      detailKey: 'progress.sshConnectionInterruptedDetail',
      recoveryHint: 'Check the network, VPN, and SSH service on the host, then retry the operation explicitly.',
      recoveryHintKey: 'progress.sshConnectionInterruptedRecoveryHint',
      targetLabel,
    },
  );
}

async function runSSHControlCommand(
  session: SSHControlSessionContext,
  remoteCommand: string,
  stdinData?: Buffer,
): Promise<SSHCommandResult> {
  try {
    const result = await session.lease.run(remoteCommand, {
      stdinData,
      signal: session.signal,
      onStderr: (chunk) => appendSSHRuntimeLog(session.logs, 'control_stderr', chunk, session.onLog),
    });
    appendSSHRuntimeLog(session.logs, 'control_stdout', result.stdout, session.onLog);
    return result;
  } catch (error) {
    if (error instanceof DesktopSSHTransportInterruptedError) {
      appendSSHRuntimeLog(session.logs, 'control_stdout', error.commandResult?.stdout ?? '', session.onLog);
      appendSSHRuntimeLog(session.logs, 'control_stderr', error.commandResult?.stderr ?? '', session.onLog);
      recordSSHControlCheckFailure(session, error);
      throw sshConnectionInterruptedFailure(session);
    }
    if (session.signal?.aborted || isAbortError(error)) {
      throw new DesktopSSHRuntimeCanceledError();
    }
    throw error;
  }
}

async function stopStreamingCommand(command: DesktopSSHStreamingCommand | null, timeoutMs: number): Promise<void> {
  if (!command) {
    return;
  }
  command.kill('SIGTERM');
  const settled = command.closed.then(() => 'closed' as const, () => 'closed' as const);
  if (await Promise.race([settled, delay(timeoutMs).then(() => 'timeout' as const)]) === 'timeout') {
    command.kill('SIGKILL');
    await settled;
  }
}

async function probeRemoteRuntimeCompatibility(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeReleaseTag: string;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<DesktopSSHRemoteRuntimeProbeResult> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_checking_runtime',
    'Checking remote runtime',
    `Looking for a Desktop-managed Redeven ${args.runtimeReleaseTag} runtime on the SSH host.`,
  );
  const result = await runSSHControlCommand(
    args.session,
    remoteShellCommand(buildManagedSSHRuntimeProbeScript(), 'redeven-ssh-runtime-probe', [
      args.session.target.runtime_root,
      args.runtimeReleaseTag,
    ]),
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not probe the managed Redeven runtime over SSH.', args.session.logs, {
      code: 'ssh_runtime_status_unavailable',
      title: 'SSH Runtime Status Unavailable',
      detail: 'Desktop reached the SSH host, but the runtime probe command did not complete successfully.',
      targetLabel: desktopSSHAuthority(args.session.target),
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
      args.session.logs,
      {
        code: 'ssh_runtime_status_unavailable',
        title: 'SSH Runtime Status Invalid',
        detail: 'The SSH host returned a runtime probe response Desktop could not parse.',
        targetLabel: desktopSSHAuthority(args.session.target),
      },
    );
  }
}

async function probeRemotePlatform(args: Readonly<{
  session: SSHControlSessionContext;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<DesktopSSHRemotePlatform> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_detecting_platform',
    'Detecting remote platform',
    'Desktop is checking the remote OS and CPU architecture before choosing a runtime package.',
  );
  const result = await runSSHControlCommand(
    args.session,
    remoteShellCommand('set -eu\nuname -s\nuname -m', 'redeven-ssh-probe-platform'),
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not determine the remote platform for SSH bootstrap.', args.session.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'Remote Platform Detection Failed',
      detail: 'Desktop reached the SSH host, but could not detect the remote OS and CPU architecture.',
      targetLabel: desktopSSHAuthority(args.session.target),
    });
  }
  const lines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) {
    throw readinessFailure('Desktop received an incomplete remote platform probe result over SSH.', args.session.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'Remote Platform Detection Failed',
      detail: 'The SSH host returned incomplete platform information.',
      targetLabel: desktopSSHAuthority(args.session.target),
    });
  }
  return resolveDesktopSSHRemotePlatform(lines[0], lines[1]);
}

async function createRemoteTempDir(args: Readonly<{
  session: SSHControlSessionContext;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<string> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_creating_upload_dir',
    'Preparing remote upload directory',
    'Desktop is creating a private temporary directory on the SSH host.',
  );
  const result = await runSSHControlCommand(
    args.session,
    remoteShellCommand('set -eu\numask 077\nmktemp -d "${TMPDIR:-/tmp}/redeven-ssh-upload.XXXXXX"', 'redeven-ssh-create-upload-dir'),
  );
  if (result.exit_code !== 0) {
    const targetLabel = desktopSSHAuthority(args.session.target);
    throw readinessFailure(`Desktop could not create a private SSH upload directory on "${targetLabel}".`, args.session.logs, {
      code: 'ssh_upload_directory_unavailable',
      title: 'SSH Upload Directory Unavailable',
      titleKey: 'progress.sshUploadDirectoryUnavailableTitle',
      summaryKey: 'progress.sshUploadDirectoryUnavailableSummary',
      detail: 'The SSH connection is still active, but the host could not create a private directory under $TMPDIR or /tmp.',
      detailKey: 'progress.sshUploadDirectoryUnavailableDetail',
      recoveryHint: 'Check free disk space, user quota, and write permissions for $TMPDIR or /tmp, then retry.',
      recoveryHintKey: 'progress.sshUploadDirectoryUnavailableRecoveryHint',
      targetLabel,
    });
  }
  const remoteDir = compact(result.stdout);
  if (remoteDir === '') {
    throw readinessFailure('Desktop received an empty remote upload directory from SSH bootstrap.', args.session.logs, {
      code: 'ssh_upload_directory_unavailable',
      title: 'SSH Upload Directory Unavailable',
      titleKey: 'progress.sshUploadDirectoryUnavailableTitle',
      summaryKey: 'progress.sshUploadDirectoryUnavailableSummary',
      detail: 'The SSH connection is still active, but the host did not report the private upload directory path.',
      detailKey: 'progress.sshUploadDirectoryUnavailableDetail',
      recoveryHint: 'Check free disk space, user quota, and write permissions for $TMPDIR or /tmp, then retry.',
      recoveryHintKey: 'progress.sshUploadDirectoryUnavailableRecoveryHint',
      targetLabel: desktopSSHAuthority(args.session.target),
    });
  }
  return remoteDir;
}

async function removeRemotePath(args: Readonly<{
  session: SSHControlSessionContext;
  remotePath: string;
}>): Promise<void> {
  if (compact(args.remotePath) === '') {
    return;
  }
  await runSSHControlCommand(
    args.session,
    remoteShellCommand('set -eu\nrm -rf "$1"', 'redeven-ssh-cleanup-path', [
        args.remotePath,
      ]),
  ).catch(() => undefined);
}

function resolveDesktopSSHReleaseFetchPolicy(startupTimeoutMs: number, connectTimeoutSeconds: number): DesktopSSHReleaseFetchPolicy {
  return {
    timeout_ms: Math.max(
      1,
      Math.floor(Math.min(startupTimeoutMs, Math.max(DEFAULT_DESKTOP_SSH_RELEASE_FETCH_TIMEOUT_MS, connectTimeoutSeconds * 1_000))),
    ),
  };
}

function preparedRuntimeStagingRoot(stdout: string): string {
  const lines = String(stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const stagingRoot = lines.at(-1) ?? '';
  if (stagingRoot === '' || !stagingRoot.includes('.staging.')) {
    throw new Error('SSH runtime preparation did not return a managed staging path.');
  }
  return stagingRoot;
}

async function prepareRemoteRuntimeViaRemoteInstall(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeReleaseTag: string;
  installScriptURL: string;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<PreparedManagedSSHRuntimePackage> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_remote_installing',
    'Installing runtime on SSH host',
    `The host is downloading and installing Redeven ${args.runtimeReleaseTag}. This can take a minute on first connection.`,
  );
  const result = await runSSHControlCommand(
    args.session,
    remoteShellCommand(buildManagedSSHRemoteInstallScript(), 'redeven-ssh-remote-install', [
      args.session.target.runtime_root,
      args.runtimeReleaseTag,
      args.installScriptURL,
    ]),
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not install Redeven on the remote host using the remote installer.', args.session.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Install Failed',
      detail: 'The remote install script did not complete successfully on the SSH host.',
      recoveryHint: 'Check network access from the SSH host to the Redeven release source, shell permissions, and the runtime root.',
      targetLabel: desktopSSHAuthority(args.session.target),
    });
  }
  return {
    stagingRoot: preparedRuntimeStagingRoot(result.stdout),
    installStrategy: 'remote_install',
  };
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

async function prepareRemoteRuntimeViaDesktopUpload(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeReleaseTag: string;
  platform: DesktopSSHRemotePlatform;
  archiveData: Buffer;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<PreparedManagedSSHRuntimePackage> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  const remoteTempDir = await createRemoteTempDir(args);
  const remoteArchivePath = `${remoteTempDir}/redeven.tar.gz`;

  try {
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_uploading_archive',
      'Uploading runtime package',
      `Desktop is sending the ${args.platform.release_package_name} archive to the SSH host.`,
    );
    const uploadResult = await runSSHControlCommand(
      args.session,
      remoteShellCommand('set -eu\ncat > "$1"', 'redeven-ssh-upload-archive', [
        remoteArchivePath,
      ]),
      args.archiveData,
    );
    if (uploadResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not upload the ${args.platform.release_package_name} release archive over SSH.`,
        args.session.logs,
        {
          code: 'ssh_runtime_install_failed',
          title: 'SSH Runtime Upload Failed',
          detail: 'Desktop could not copy the runtime package archive to the SSH host.',
          recoveryHint: 'Check SSH permissions, available disk space, and the remote temporary directory.',
          targetLabel: desktopSSHAuthority(args.session.target),
        },
      );
    }

    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_installing_upload',
      'Installing uploaded runtime',
      `The SSH host is unpacking Redeven ${args.runtimeReleaseTag} and writing the Desktop runtime stamp.`,
    );
    const installResult = await runSSHControlCommand(
      args.session,
      remoteShellCommand(buildManagedSSHUploadedInstallScript(), 'redeven-ssh-upload-install', [
        args.session.target.runtime_root,
        args.runtimeReleaseTag,
        remoteArchivePath,
        remoteTempDir,
      ]),
    );
    if (installResult.exit_code !== 0) {
      throw readinessFailure(
        `Desktop could not install the uploaded ${args.platform.platform_label} Redeven package on the remote host.`,
        args.session.logs,
        {
          code: 'ssh_runtime_install_failed',
          title: 'SSH Runtime Install Failed',
          detail: 'The SSH host could not unpack or stamp the uploaded runtime package.',
          recoveryHint: 'Check runtime root permissions, available disk space, and shell access on the SSH host.',
          targetLabel: desktopSSHAuthority(args.session.target),
        },
      );
    }
    return {
      stagingRoot: preparedRuntimeStagingRoot(installResult.stdout),
      installStrategy: 'desktop_upload',
    };
  } finally {
    await removeRemotePath({
      session: args.session,
      remotePath: remoteTempDir,
    });
  }
}

async function prepareRemoteRuntimePackage(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeReleaseTag: string;
  installScriptURL: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  forceRuntimeUpdate?: boolean;
  packageIntent?: ManagedRuntimePackageIntent;
  fetchPolicy: DesktopSSHReleaseFetchPolicy;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<PreparedManagedSSHRuntimePackage | null> {
  const packageIntent = args.packageIntent ?? (args.forceRuntimeUpdate === true ? 'replace_with_desktop_target' : 'install_if_missing');
  const initialProbe = await probeRemoteRuntimeCompatibility({
    ...args,
  });
  const shouldReplaceRuntimePackage = packageIntent === 'replace_with_desktop_target';
  if (initialProbe.status === 'ready' && !shouldReplaceRuntimePackage) {
    return null;
  }
  if (packageIntent === 'use_installed') {
    throw new Error(describeManagedSSHRuntimeProbeResult(initialProbe));
  }
  if (!shouldReplaceRuntimePackage && initialProbe.status !== 'missing_binary') {
    throw new Error(describeManagedSSHRuntimeProbeResult(initialProbe));
  }

  if (args.session.target.bootstrap_strategy === 'remote_install') {
    return prepareRemoteRuntimeViaRemoteInstall(args);
  }
  const platform = await probeRemotePlatform(args);
  const preparedUpload = await prepareDesktopSSHUploadAsset({
    target: args.session.target,
    runtimeReleaseTag: args.runtimeReleaseTag,
    assetCacheRoot: args.assetCacheRoot,
    sourceRuntimeRoot: args.sourceRuntimeRoot,
    platform,
    fetchPolicy: args.fetchPolicy,
    onProgress: args.onProgress,
    signal: args.session.signal,
  });
  return prepareRemoteRuntimeViaDesktopUpload({
    session: args.session,
    runtimeReleaseTag: args.runtimeReleaseTag,
    platform,
    archiveData: preparedUpload.archiveData,
    onProgress: args.onProgress,
  });
}

async function activatePreparedRemoteRuntimePackage(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeReleaseTag: string;
  prepared: PreparedManagedSSHRuntimePackage;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
}>): Promise<void> {
  throwIfSSHRuntimeCanceled(args.session.signal);
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_activating_runtime_package',
    'Activating prepared runtime package',
    `Desktop is switching the verified SSH runtime slot to Redeven ${args.runtimeReleaseTag}.`,
  );
  const result = await runSSHControlCommand(
    args.session,
    remoteShellCommand(buildManagedSSHActivatePreparedRuntimeScript(), 'redeven-ssh-activate-runtime', [
      args.session.target.runtime_root,
      args.runtimeReleaseTag,
      args.prepared.stagingRoot,
    ]),
  );
  if (result.exit_code !== 0) {
    throw readinessFailure('Desktop could not activate the prepared SSH runtime package.', args.session.logs, {
      code: 'ssh_runtime_install_failed',
      title: 'SSH Runtime Activation Failed',
      detail: 'The SSH host rejected or could not atomically switch the prepared managed runtime slot.',
      recoveryHint: 'Retry Update after checking runtime root permissions and available disk space.',
      targetLabel: desktopSSHAuthority(args.session.target),
    });
  }
}

async function waitForRemoteStartupReport(args: Readonly<{
  session: SSHControlSessionContext;
  runtimeStateRoot?: string;
  sessionToken: string;
  runtimeReleaseTag: string;
  startupTimeoutMs: number;
  onProgress: StartManagedSSHRuntimeArgs['onProgress'];
  getControlProcess: () => DesktopSSHStreamingCommand | null;
  getControlResult: () => SSHCommandResult | null;
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
    throwIfSSHRuntimeCanceled(args.session.signal);
    const controlProcess = args.getControlProcess();
    if (!controlProcess) {
      throw readinessFailure('Desktop lost the SSH runtime bootstrap session before Redeven reported readiness.', args.session.logs, {
        code: 'ssh_runtime_launch_failed',
        title: 'SSH Runtime Launch Failed',
        detail: 'The remote launch command ended before Desktop could read the startup report.',
        targetLabel: desktopSSHAuthority(args.session.target),
      });
    }

    const result = await runSSHControlCommand(
      args.session,
      remoteShellCommand(script, 'redeven-ssh-read-report', [
        args.session.target.runtime_root,
        args.runtimeStateRoot ?? args.session.target.runtime_root,
        args.sessionToken,
      ]),
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
                args.session.logs,
                {
                  title: 'SSH Runtime Launch Timed Out',
                  detail: 'Redeven is running on the SSH host, but Desktop could not verify the management socket before the timeout.',
                  targetLabel: desktopSSHAuthority(args.session.target),
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
          args.session.logs,
          {
            code: 'ssh_runtime_launch_failed',
            title: 'SSH Runtime Startup Report Invalid',
            detail: 'Redeven started on the SSH host but wrote a startup report Desktop could not use.',
            targetLabel: desktopSSHAuthority(args.session.target),
          },
        );
      }
    }

    const controlResult = args.getControlResult();
    if (controlResult) {
      if (controlResult.exit_code === 0 && !controlResult.signal) {
        if (Date.now() >= deadline) {
          throw readinessTimeoutFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.session.logs, {
            title: 'SSH Runtime Launch Timed Out',
            detail: 'Redeven did not write its startup report on the SSH host before the timeout.',
            targetLabel: desktopSSHAuthority(args.session.target),
          });
        }
        await delay(DEFAULT_SSH_POLL_INTERVAL_MS);
        continue;
      }
      const exitReason = controlResult.exit_code !== null
        ? `exit code ${controlResult.exit_code}`
        : `signal ${controlResult.signal}`;
      throw readinessFailure(`Remote Redeven launcher failed before reporting readiness (${exitReason}).`, args.session.logs, {
        code: 'ssh_runtime_launch_failed',
        title: 'SSH Runtime Launch Failed',
        detail: 'The remote Redeven process exited before Desktop could read its startup report.',
        targetLabel: desktopSSHAuthority(args.session.target),
      });
    }

    if (Date.now() >= deadline) {
      throw readinessTimeoutFailure('Timed out waiting for remote Redeven to report readiness over SSH.', args.session.logs, {
        title: 'SSH Runtime Launch Timed Out',
        detail: 'Redeven did not write its startup report on the SSH host before the timeout.',
        targetLabel: desktopSSHAuthority(args.session.target),
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

function managedSSHRuntimeBinaryPath(target: DesktopSSHEnvironmentDetails): string {
  const runtimeRoot = compact(target.runtime_root);
  const rootLabel = runtimeRoot === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT
    ? '~/.redeven'
    : runtimeRoot;
  return `${rootLabel.replace(/\/+$/u, '')}/runtime/managed/bin/redeven`;
}

function runtimeIdentityMismatchDiagnostic(
  startup: StartupReport,
  args: Readonly<{
    target: DesktopSSHEnvironmentDetails;
    runtimeStateRoot?: string;
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
    state_dir: compact(startup.state_dir) || compact(args.runtimeStateRoot) || compact(args.target.runtime_root) || undefined,
    runtime_control_base_url: compact(startup.runtime_control?.base_url) || undefined,
    binary_path: managedSSHRuntimeBinaryPath(args.target),
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
    launchMode: ManagedSSHRemoteStartup['launch_mode'];
    allowActiveWorkReplacement: boolean;
    allowProcessRestart: boolean;
    enforceTargetRuntimeIdentity: boolean;
    targetRuntimeVersion: string;
  }>,
): ManagedSSHRuntimeAttachPolicy {
  const runtimeService = startup.runtime_service;
  const expectedRuntimeIdentity: RuntimeServiceIdentity | null = args.enforceTargetRuntimeIdentity
    ? { runtime_version: args.targetRuntimeVersion }
    : null;
  const runtimeIdentityMismatch = expectedRuntimeIdentity !== null
    && !runtimeServiceMatchesIdentity(runtimeService, expectedRuntimeIdentity);
  const attachedRuntimeNeedsUpdateRestart = args.enforceTargetRuntimeIdentity && args.launchMode === 'attached';
  const runtimeReplacementRequired = runtimeIdentityMismatch || attachedRuntimeNeedsUpdateRestart;

  if (!runtimeReplacementRequired) {
    return { action: 'reuse' };
  }

  const maintenanceMessage = 'Restart this SSH runtime to finish applying the selected runtime update.';
  const maintenance = buildDesktopRuntimeMaintenanceRequirement({
    kind: 'runtime_update_required',
    required_for: 'open',
    recovery_action: 'update_runtime',
    can_desktop_start: false,
    can_desktop_restart: startupReportsStoppablePID(startup),
    has_active_work: runtimeServiceHasActiveWork(runtimeService),
    active_work_label: formatRuntimeServiceWorkload(runtimeService),
    current_runtime_version: runtimeService?.runtime_version,
    target_runtime_version: args.targetRuntimeVersion,
    message: maintenanceMessage,
  });

  if (!args.allowProcessRestart) {
    return {
      action: 'block',
      message: maintenanceMessage,
      maintenance,
    };
  }
  if (runtimeServiceHasActiveWork(runtimeService) && !args.allowActiveWorkReplacement) {
    return {
      action: 'block',
      message: 'This SSH runtime needs to restart to finish the selected runtime update, but active work is still running.',
      maintenance,
    };
  }
  if (!startupReportsStoppablePID(startup)) {
    return {
      action: 'block',
      message: 'This SSH runtime needs to restart to finish the selected runtime update, but it did not report a process id Desktop can stop.',
      maintenance,
    };
  }
  return {
    action: 'replace',
    message: 'Restarting SSH runtime to finish applying the selected runtime update.',
  };
}

async function startManagedSSHRuntimeInternal(
  args: StartManagedSSHRuntimeArgs,
): Promise<ManagedSSHRuntimeReady> {
  throwIfSSHRuntimeCanceled(args.signal);
  const target = normalizeDesktopSSHEnvironmentDetails(args.target);
  const runtimeReleaseTag = normalizeRuntimeReleaseTag(args.runtimeReleaseTag);
  const desktopOwnerID = compact(args.desktopOwnerID);
  if (desktopOwnerID === '') {
    throw new Error('Desktop owner id is required before starting a managed SSH runtime.');
  }
  const installScriptURL = compact(args.installScriptURL) || PUBLIC_INSTALL_SCRIPT_URL;
  const tempRoot = compact(args.tempRoot) || os.tmpdir();
  const assetCacheRoot = compact(args.assetCacheRoot) || path.join(tempRoot, 'redeven-ssh-release-cache');
  const startupTimeoutMs = args.startupTimeoutMs ?? DEFAULT_SSH_STARTUP_TIMEOUT_MS;
  const stopTimeoutMs = args.stopTimeoutMs ?? DEFAULT_SSH_STOP_TIMEOUT_MS;
  const connectTimeoutSeconds = args.connectTimeoutSeconds ?? DEFAULT_SSH_CONNECT_TIMEOUT_SECONDS;
  const releaseFetchPolicy = resolveDesktopSSHReleaseFetchPolicy(startupTimeoutMs, connectTimeoutSeconds);
  const runtimeProcessIntent = args.runtimeProcessIntent
    ?? (args.forceRuntimeUpdate === true ? 'update' : 'start');
  const packageIntent: ManagedRuntimePackageIntent = runtimeProcessIntent === 'update'
    ? 'replace_with_desktop_target'
    : runtimeProcessIntent === 'restart'
      ? 'use_installed'
      : 'install_if_missing';
  const logs = createMutableRecentLogs();

  const sessionToken = randomBytes(8).toString('hex');

  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_connecting',
    'Opening SSH control connection',
    `Connecting to ${target.ssh_destination} with ${target.auth_mode === 'password' ? 'password prompt' : 'SSH key or agent'} authentication.`,
  );
  let lease: DesktopSSHTransportLease;
  try {
    lease = await args.sshTransportManager.acquire({
      target,
      credentialScope: args.sshCredentialScope,
      sshPassword: args.sshPassword,
      sshBinary: args.sshBinary,
      readyTimeoutMs: startupTimeoutMs,
      signal: args.signal,
    });
  } catch (error) {
    if (error instanceof DesktopSSHTransportUnavailableError) {
      appendSSHRuntimeLog(logs, 'master_stderr', error.stderr, args.onLog);
    }
    if (args.signal?.aborted || isAbortError(error)) {
      throw new DesktopSSHRuntimeCanceledError();
    }
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      throw missingSSHBinaryError(logs);
    }
    throw readinessFailure('Desktop could not establish the SSH control connection.', logs, {
      code: 'ssh_connection_failed',
      title: 'SSH Connection Failed',
      summary: `SSH connection to "${desktopSSHAuthority(target)}" failed.`,
      detail: error instanceof Error ? error.message : 'The SSH control connection did not become ready.',
      recoveryHint: 'Check the SSH host, ~/.ssh/config alias, VPN, network connection, and authentication method.',
      targetLabel: desktopSSHAuthority(target),
    });
  }
  const controlSession: SSHControlSessionContext = {
    target,
    lease,
    logs,
    onLog: args.onLog,
    signal: args.signal,
  };
  emitSSHRuntimeProgress(
    args.onProgress,
    'ssh_control_ready',
    'SSH control connection is ready',
    'Desktop established the reusable SSH control socket.',
  );

  let controlProcess: DesktopSSHStreamingCommand | null = null;
  let controlProcessResult: SSHCommandResult | null = null;
  let remoteStopAttempted = false;
  let transportDisconnected = false;
  let preparedRuntimePackage: PreparedManagedSSHRuntimePackage | null = null;

  const disconnect = async () => {
    if (transportDisconnected) {
      return;
    }
    transportDisconnected = true;
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_cleaning_startup_resources',
      'Cleaning SSH startup resources',
      'Desktop is closing SSH startup processes and temporary files.',
    );
    await stopStreamingCommand(controlProcess, stopTimeoutMs).catch(() => undefined);
    controlProcess = null;
    await lease.release();
  };

  const stop = async () => {
    try {
      if (!remoteStopAttempted) {
        remoteStopAttempted = true;
        const processArgs: ManagedSSHRuntimeProcessInventoryArgs = {
          sshTransportManager: args.sshTransportManager,
          sshCredentialScope: args.sshCredentialScope,
          target,
          runtimeReleaseTag,
          desktopOwnerID,
          runtimeStateRoot: args.runtimeStateRoot,
          sshPassword: args.sshPassword,
          sshBinary: args.sshBinary,
          tempRoot,
          assetCacheRoot,
          sourceRuntimeRoot: args.sourceRuntimeRoot,
          connectTimeoutSeconds,
          onLog: args.onLog,
          runtimeProcessReconciliation: args.runtimeProcessReconciliation,
        };
        const inventory = await inspectManagedSSHRuntimeProcesses(processArgs);
        requireDesktopRuntimeProcessReconciliation(inventory, args.runtimeProcessReconciliation);
        if (inventory.instances.length > 0) {
          await stopManagedSSHRuntimeProcesses(processArgs, inventory, stopTimeoutMs);
        }
      }
    } finally {
      await disconnect();
    }
  };

  try {
    const packageArgs = {
      session: controlSession,
      runtimeReleaseTag,
      installScriptURL,
      assetCacheRoot,
      sourceRuntimeRoot: args.sourceRuntimeRoot,
      forceRuntimeUpdate: args.forceRuntimeUpdate,
      packageIntent,
      fetchPolicy: releaseFetchPolicy,
      onProgress: args.onProgress,
    } as const;
    preparedRuntimePackage = await prepareRemoteRuntimePackage(packageArgs);

    const processArgs: ManagedSSHRuntimeProcessInventoryArgs = {
      sshTransportManager: args.sshTransportManager,
      sshCredentialScope: args.sshCredentialScope,
      transportLease: lease,
      target,
      runtimeReleaseTag,
      desktopOwnerID,
      runtimeStateRoot: args.runtimeStateRoot,
      sshPassword: args.sshPassword,
      sshBinary: args.sshBinary,
      tempRoot,
      assetCacheRoot,
      sourceRuntimeRoot: args.sourceRuntimeRoot,
      connectTimeoutSeconds,
      onLog: args.onLog,
      onProgress: args.onProgress,
      runtimeProcessReconciliation: args.runtimeProcessReconciliation,
    };
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_discovering_runtime_instances',
      'Discovering runtime processes',
      'Desktop is verifying Runtime process identities on the SSH host.',
    );
    const processInventory = await inspectManagedSSHRuntimeProcesses(processArgs);
    requireDesktopRuntimeProcessReconciliation(processInventory, args.runtimeProcessReconciliation);
    if (runtimeProcessIntent === 'start' && processInventory.summary.automatic > 1) {
      const maintenance = buildDesktopRuntimeMaintenanceRequirement({
        kind: 'runtime_restart_required',
        required_for: 'open',
        recovery_action: 'restart_runtime',
        can_desktop_start: false,
        can_desktop_restart: true,
        has_active_work: true,
        active_work_label: 'Runtime process reconciliation required',
        target_runtime_version: runtimeReleaseTag,
        message: `Desktop found ${processInventory.summary.automatic} verified SSH Runtime processes for this target. Restart or update this Runtime before opening it.`,
      });
      throw new DesktopSSHRuntimeMaintenanceRequiredError(maintenance.message, maintenance);
    }
    if (runtimeProcessIntent !== 'start') {
      await args.beforeRuntimeReplacement?.();
    }
    if (runtimeProcessIntent !== 'start' && processInventory.instances.length > 0) {
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_stopping_runtime_process',
        'Stopping Runtime processes',
        `Desktop is stopping ${desktopRuntimeProcessStopTargetCount(processInventory, args.runtimeProcessReconciliation)} verified SSH Runtime process(es).`,
      );
      await stopManagedSSHRuntimeProcesses(processArgs, processInventory, stopTimeoutMs);
      emitSSHRuntimeProgress(
        args.onProgress,
        'ssh_verifying_runtime_inventory',
        'Verifying runtime process inventory',
        'Desktop confirmed that no matching runtime process remains on the SSH host.',
      );
    }
    if (preparedRuntimePackage) {
      await activatePreparedRemoteRuntimePackage({
        ...packageArgs,
        prepared: preparedRuntimePackage,
      });
      preparedRuntimePackage = null;
      const activatedProbe = await probeRemoteRuntimeCompatibility({
        ...packageArgs,
      });
      if (activatedProbe.status !== 'ready') {
        throw new Error(describeManagedSSHRuntimeProbeResult(activatedProbe));
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
      controlProcessResult = null;
      controlProcess = lease.stream(
        remoteShellCommand(buildManagedSSHStartScript(), 'redeven-ssh-start', [
          target.runtime_root,
          args.runtimeStateRoot ?? target.runtime_root,
          runtimeReleaseTag,
          sessionToken,
          desktopOwnerID,
        ]),
        {
          signal: args.signal,
          onStderr: (chunk) => appendSSHRuntimeLog(logs, 'control_stderr', chunk, args.onLog),
        },
      );
      void controlProcess.result.then((result) => {
        controlProcessResult = result;
      }).catch(() => undefined);
      void controlProcess.closed.catch(() => undefined);
      controlProcess.stdout.setEncoding('utf8');
      controlProcess.stdout.on('data', (chunk: string) => {
        appendSSHRuntimeLog(logs, 'control_stdout', chunk, args.onLog);
      });

      const launch = await waitForRemoteStartupReport({
        session: controlSession,
        runtimeStateRoot: args.runtimeStateRoot,
        sessionToken,
        runtimeReleaseTag,
        startupTimeoutMs,
        onProgress: args.onProgress,
        getControlProcess: () => controlProcess,
        getControlResult: () => controlProcessResult,
      });
      const attachPolicy = managedSSHRuntimeAttachPolicy(launch.startup, {
        launchMode: launch.launch_mode,
        allowActiveWorkReplacement: args.allowActiveWorkReplacement === true,
        allowProcessRestart: packageIntent === 'replace_with_desktop_target' || args.allowActiveWorkReplacement === true,
        enforceTargetRuntimeIdentity: packageIntent === 'replace_with_desktop_target',
        targetRuntimeVersion: runtimeReleaseTag,
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
          runtimeStateRoot: args.runtimeStateRoot,
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
      const replacementProcessArgs: ManagedSSHRuntimeProcessInventoryArgs = {
        sshTransportManager: args.sshTransportManager,
        sshCredentialScope: args.sshCredentialScope,
        transportLease: lease,
        target,
        runtimeReleaseTag,
        desktopOwnerID,
        runtimeStateRoot: args.runtimeStateRoot,
        sshPassword: args.sshPassword,
        sshBinary: args.sshBinary,
        tempRoot,
        assetCacheRoot,
        sourceRuntimeRoot: args.sourceRuntimeRoot,
        connectTimeoutSeconds,
        onLog: args.onLog,
        runtimeProcessReconciliation: args.runtimeProcessReconciliation,
      };
      const replacementInventory = await inspectManagedSSHRuntimeProcesses(replacementProcessArgs);
      requireDesktopRuntimeProcessReconciliation(replacementInventory, args.runtimeProcessReconciliation);
      if (replacementInventory.instances.length === 0) {
        throw new Error('Desktop could not verify the SSH runtime process inventory before replacement.');
      }
      await stopManagedSSHRuntimeProcesses(replacementProcessArgs, replacementInventory, stopTimeoutMs);
      await stopStreamingCommand(controlProcess, stopTimeoutMs).catch(() => undefined);
      controlProcess = null;
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
    emitSSHRuntimeProgress(
      args.onProgress,
      'ssh_verifying_runtime_inventory',
      'Verifying runtime process inventory',
      'Desktop is confirming the final SSH runtime process identity.',
    );
    const finalInventory = await inspectManagedSSHRuntimeProcesses(processArgs);
    const finalInstance = finalInventory.instances[0];
    const expectedFinalRuntimeVersion = runtimeProcessIntent === 'update'
      ? runtimeReleaseTag
      : normalizeRuntimeReleaseTag(remoteStartup.runtime_service?.runtime_version ?? runtimeReleaseTag);
    const finalIdentityIssues = [
      ...(finalInventory.summary.blocked > 0 ? [`blocked=${finalInventory.summary.blocked}`] : []),
      ...(finalInventory.summary.confirmed_takeover > 0 ? [`takeover=${finalInventory.summary.confirmed_takeover}`] : []),
      ...(!desktopRuntimeProcessInventoryHasSingleCurrentOwner(finalInventory) ? ['current_owner=invalid'] : []),
      ...(finalInventory.instances.length !== 1 ? [`instances=${finalInventory.instances.length}`] : []),
      ...(!finalInstance ? ['instance=missing'] : []),
      ...(finalInstance && finalInstance.pid !== remoteStartup.pid ? [`pid=${finalInstance.pid}, expected=${remoteStartup.pid}`] : []),
      ...(finalInstance && finalInstance.desktop_owner_id !== desktopOwnerID ? ['owner=mismatch'] : []),
      ...(finalInstance && finalInstance.state_root !== finalInventory.scope.state_root ? ['state_root=mismatch'] : []),
      ...(finalInstance && finalInstance.namespace_id !== finalInventory.scope.namespace_id ? ['namespace=mismatch'] : []),
      ...(finalInstance && compact(finalInstance.runtime_version) === '' ? ['version=missing'] : []),
      ...(
        finalInstance
        && compact(finalInstance.runtime_version) !== ''
        && normalizeRuntimeReleaseTag(finalInstance.runtime_version ?? '') !== expectedFinalRuntimeVersion
          ? [`version=${finalInstance.runtime_version}, expected=${expectedFinalRuntimeVersion}`]
          : []
      ),
    ];
    if (finalIdentityIssues.length > 0) {
      throw new Error(`Desktop could not verify a single current SSH runtime process after startup (${finalIdentityIssues.join('; ')}).`);
    }
    if (runtimeProcessIntent !== 'start' && processInventory.instances.some((instance) => (
      instance.pid === finalInstance.pid
      && instance.process_started_at_unix_ms === finalInstance.process_started_at_unix_ms
    ))) {
      throw new Error('Desktop SSH runtime replacement completed without changing the process identity.');
    }
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
  } catch (error) {
    if (preparedRuntimePackage) {
      await removeRemotePath({
        session: controlSession,
        remotePath: preparedRuntimePackage.stagingRoot,
      });
      preparedRuntimePackage = null;
    }
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
  args: StartManagedSSHRuntimeArgs,
): Promise<ManagedSSHRuntimeReady> {
  return await startManagedSSHRuntimeInternal(args);
}
