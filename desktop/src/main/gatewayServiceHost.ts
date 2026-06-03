import {
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type {
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  containerRuntimeExecCommand,
  containerRuntimePlatformProbeCommand,
  containerRuntimeRootShellPrelude,
  parseContainerPlatformProbeOutput,
} from './containerRuntime';
import {
  prepareDesktopRuntimeUploadAsset,
  runtimeReleaseFetchPolicy,
} from './runtimePackageCache';
import { createSSHRuntimeHostExecutor, type RuntimeHostAccessExecutor } from './runtimeHostAccess';
import {
  buildDesktopSSHReleaseAssetURL,
  desktopSSHReleasePackageName,
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';

export type GatewayServicePackageProbeStatus =
  | 'ready'
  | 'missing_binary'
  | 'binary_not_executable'
  | 'version_command_failed'
  | 'version_output_invalid'
  | 'slot_version_mismatch'
  | 'stamp_missing'
  | 'stamp_invalid';

export type GatewayServiceStatus =
  | 'running'
  | 'not_running'
  | 'needs_update'
  | 'failed';

export type GatewayServiceProbe = Readonly<{
  status: GatewayServiceStatus;
  message: string;
  binary_path: string;
  state_root: string;
  pid?: number;
  listen?: string;
  package_status?: GatewayServicePackageProbeStatus;
}>;

export type GatewayServiceProgressPhase =
  | 'checking_host'
  | 'checking_container'
  | 'preparing_gateway_package'
  | 'installing_gateway'
  | 'starting_gateway'
  | 'stopping_gateway'
  | 'verifying_gateway_stopped'
  | 'gateway_ready';

export type GatewayServiceProgress = Readonly<{
  phase: GatewayServiceProgressPhase;
  title: string;
  detail: string;
}>;

export type GatewayServiceHostOptions = Readonly<{
  target: DesktopSSHEnvironmentDetails;
  placement: DesktopRuntimePlacement;
  stateRoot: string;
  releaseTag: string;
  releaseBaseURL: string;
  assetCacheRoot: string;
  sourceRuntimeRoot?: string;
  sshPassword?: string;
  tempRoot: string;
  forceUpdate?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: GatewayServiceProgress) => void;
}>;

type GatewayPackageProbe = Readonly<{
  status: GatewayServicePackageProbeStatus;
  binary_path: string;
  stamp_path: string;
  slot_release_tag: string | null;
  reported_release_tag: string | null;
  target_release_tag: string | null;
  reason: string;
}>;

type GatewayServiceCommandStatus = Readonly<{
  status: string;
  pid?: number;
  listen?: string;
  state_root?: string;
  error_message?: string;
}>;

const MANAGED_GATEWAY_STAMP_FILENAME = 'managed-gateway.stamp';
const MANAGED_GATEWAY_STAMP_SCHEMA_VERSION = 1;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeReleaseTag(raw: string): string {
  const clean = compact(raw);
  if (clean === '') {
    throw new Error('Desktop could not resolve the Gateway release tag.');
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function hostRootShell(variableName: string): string {
  return [
    `${variableName}_raw="$1"`,
    `if [ "$${variableName}_raw" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    `    echo "remote HOME is unavailable; set ${variableName} to an absolute .redeven path" >&2`,
    '    exit 1',
    '  fi',
    `  ${variableName}="\${HOME%/}/.redeven"`,
    'else',
    `  ${variableName}="$${variableName}_raw"`,
    'fi',
    `case "$${variableName}" in`,
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    `      echo "remote HOME is unavailable; set ${variableName} to an absolute .redeven path" >&2`,
    '      exit 1',
    '    fi',
    `    ${variableName}="\${HOME%/}/.redeven/\${${variableName}#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
  ].join('\n');
}

function hostStateShell(): string {
  return [
    'state_root_raw="$2"',
    `if [ "$state_root_raw" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "remote HOME is unavailable; set state_root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    '  state_root="${HOME%/}/.redeven"',
    'else',
    '  state_root="$state_root_raw"',
    'fi',
    'case "$state_root" in',
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "remote HOME is unavailable; set state_root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    state_root="\${HOME%/}/.redeven/\${state_root#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
  ].join('\n');
}

function containerRootShell(): string {
  return [
    'runtime_root="$1"',
    containerRuntimeRootShellPrelude('runtime_root'),
    'state_root="$2"',
    containerRuntimeRootShellPrelude('state_root'),
  ].join('\n');
}

function managedGatewayPathShell(targetReleaseArg = '3'): string {
  return [
    `target_release_tag="\${${targetReleaseArg}:-}"`,
    'managed_root="${runtime_root%/}/gateway/managed"',
    'bin_dir="${managed_root}/bin"',
    'binary="${bin_dir}/redeven-gateway"',
    `stamp_path="\${managed_root}/${MANAGED_GATEWAY_STAMP_FILENAME}"`,
  ].join('\n');
}

function gatewayStampShell(): string {
  return [
    'write_gateway_stamp() {',
    '  install_strategy="$1"',
    '  release_tag="$2"',
    '  mkdir -p "$managed_root"',
    '  {',
    `    printf 'schema_version=${MANAGED_GATEWAY_STAMP_SCHEMA_VERSION}\\n'`,
    `    printf 'managed_by=redeven-desktop\\n'`,
    `    printf 'slot_release_tag=%s\\n' "$release_tag"`,
    `    printf 'install_strategy=%s\\n' "$install_strategy"`,
    '  } > "$stamp_path"',
    '}',
  ].join('\n');
}

function gatewayProbeShell(): string {
  return [
    'probe_status=""',
    'probe_reason=""',
    'slot_release_tag=""',
    'reported_release_tag=""',
    'gateway_package_is_ready() {',
    '  if [ ! -e "$binary" ]; then',
    '    probe_status="missing_binary"',
    '    probe_reason="managed Gateway binary is missing"',
    '    return 1',
    '  fi',
    '  if [ ! -x "$binary" ]; then',
    '    probe_status="binary_not_executable"',
    '    probe_reason="managed Gateway binary is not executable"',
    '    return 1',
    '  fi',
    '  if ! version_output="$("$binary" version 2>/dev/null)"; then',
    '    probe_status="version_command_failed"',
    '    probe_reason="managed Gateway failed to report its version"',
    '    return 1',
    '  fi',
    '  set -- $version_output',
    '  if [ "${1:-}" != "redeven-gateway" ] || [ -z "${2:-}" ]; then',
    '    probe_status="version_output_invalid"',
    '    probe_reason="managed Gateway returned an invalid version string"',
    '    return 1',
    '  fi',
    '  reported_release_tag="$2"',
    '  case "$reported_release_tag" in v*) ;; *) reported_release_tag="v$reported_release_tag" ;; esac',
    '  if [ ! -f "$stamp_path" ]; then',
    '    probe_status="stamp_missing"',
    '    probe_reason="managed Gateway stamp is missing"',
    '    return 1',
    '  fi',
    `  if ! grep -Fx "schema_version=${MANAGED_GATEWAY_STAMP_SCHEMA_VERSION}" "$stamp_path" >/dev/null 2>&1; then`,
    '    probe_status="stamp_invalid"',
    '    probe_reason="managed Gateway stamp schema is invalid"',
    '    return 1',
    '  fi',
    '  if ! grep -Fx "managed_by=redeven-desktop" "$stamp_path" >/dev/null 2>&1; then',
    '    probe_status="stamp_invalid"',
    '    probe_reason="managed Gateway stamp owner is invalid"',
    '    return 1',
    '  fi',
    '  while IFS= read -r stamp_line; do',
    '    case "$stamp_line" in',
    '      slot_release_tag=*) slot_release_tag="${stamp_line#slot_release_tag=}" ;;',
    '    esac',
    '  done < "$stamp_path"',
    '  case "$slot_release_tag" in',
    '    "") probe_status="stamp_invalid"; probe_reason="managed Gateway stamp release is missing"; return 1 ;;',
    '    v*) ;;',
    '    *) slot_release_tag="v$slot_release_tag" ;;',
    '  esac',
    '  if [ "$slot_release_tag" != "$reported_release_tag" ]; then',
    '    probe_status="slot_version_mismatch"',
    '    probe_reason="managed Gateway stamp release does not match the installed binary"',
    '    return 1',
    '  fi',
    '  if [ -n "$target_release_tag" ]; then',
    '    case "$target_release_tag" in v*) ;; *) target_release_tag="v$target_release_tag" ;; esac',
    '    if [ "$reported_release_tag" != "$target_release_tag" ]; then',
    '      probe_status="slot_version_mismatch"',
    '      probe_reason="managed Gateway version does not match the Desktop target release"',
    '      return 1',
    '    fi',
    '  fi',
    '  probe_status="ready"',
    '  probe_reason="desktop-managed Gateway slot is ready"',
    '  return 0',
    '}',
  ].join('\n');
}

function gatewayProbeCommandScript(rootShell: string): string {
  return [
    'set -eu',
    rootShell,
    managedGatewayPathShell(),
    gatewayProbeShell(),
    'gateway_package_is_ready || true',
    'printf "status=%s\\n" "$probe_status"',
    'printf "slot_release_tag=%s\\n" "$slot_release_tag"',
    'printf "reported_release_tag=%s\\n" "$reported_release_tag"',
    'printf "target_release_tag=%s\\n" "$target_release_tag"',
    'printf "binary_path=%s\\n" "$binary"',
    'printf "stamp_path=%s\\n" "$stamp_path"',
    'printf "reason=%s\\n" "$probe_reason"',
  ].join('\n');
}

function gatewayUploadedInstallScript(rootShell: string): string {
  return [
    'set -eu',
    rootShell,
    managedGatewayPathShell(),
    gatewayStampShell(),
    'if [ -z "$target_release_tag" ]; then',
    '  echo "target release tag is required for uploaded Gateway install" >&2',
    '  exit 1',
    'fi',
    'mkdir -p "${runtime_root%/}/gateway"',
    'upload_dir="$(mktemp -d "${TMPDIR:-/tmp}/redeven-gateway-upload.XXXXXX")"',
    'archive_path="${upload_dir}/redeven-gateway.tar.gz"',
    'extract_dir="$(mktemp -d "${upload_dir%/}/extract.XXXXXX")"',
    'staging_root="$(mktemp -d "${runtime_root%/}/gateway/managed.staging.XXXXXX")"',
    'cleanup() { rm -rf "$upload_dir" "$extract_dir" "$staging_root"; }',
    'trap cleanup EXIT INT TERM',
    'cat > "$archive_path"',
    'if tar --warning=no-unknown-keyword -xzf "$archive_path" -C "$extract_dir" 2>/dev/null; then',
    '  :',
    'elif tar -xzf "$archive_path" -C "$extract_dir"; then',
    '  :',
    'else',
    '  echo "failed to extract uploaded Redeven Gateway archive" >&2',
    '  exit 1',
    'fi',
    'binary_path="${extract_dir}/redeven-gateway"',
    'if [ ! -f "$binary_path" ]; then',
    '  echo "uploaded Redeven Gateway archive did not contain redeven-gateway" >&2',
    '  exit 1',
    'fi',
    'mkdir -p "${staging_root}/bin"',
    'mv "$binary_path" "${staging_root}/bin/redeven-gateway"',
    'chmod +x "${staging_root}/bin/redeven-gateway"',
    'if ! staged_version_output="$("${staging_root}/bin/redeven-gateway" version 2>/dev/null)"; then',
    '  echo "uploaded Redeven Gateway binary failed to report its version" >&2',
    '  exit 1',
    'fi',
    'set -- $staged_version_output',
    'if [ "${1:-}" != "redeven-gateway" ]; then',
    '  echo "uploaded Redeven Gateway binary reported an invalid product name" >&2',
    '  exit 1',
    'fi',
    'staged_release_tag="${2:-}"',
    'case "$staged_release_tag" in v*) ;; *) staged_release_tag="v$staged_release_tag" ;; esac',
    'if [ "$staged_release_tag" != "$target_release_tag" ]; then',
    '  echo "uploaded Redeven Gateway binary reported $staged_release_tag instead of $target_release_tag" >&2',
    '  exit 1',
    'fi',
    'old_managed_root="$managed_root"',
    'old_stamp_path="$stamp_path"',
    'managed_root="$staging_root"',
    `stamp_path="\${managed_root}/${MANAGED_GATEWAY_STAMP_FILENAME}"`,
    'write_gateway_stamp "desktop_upload" "$target_release_tag"',
    'managed_root="$old_managed_root"',
    'stamp_path="$old_stamp_path"',
    'previous_managed_root="${managed_root}.previous.$$"',
    'rm -rf "$previous_managed_root"',
    'if [ -e "$managed_root" ]; then',
    '  mv "$managed_root" "$previous_managed_root"',
    'fi',
    'if mv "$staging_root" "$managed_root"; then',
    '  rm -rf "$previous_managed_root"',
    '  trap - EXIT INT TERM',
    '  rm -rf "$upload_dir" "$extract_dir"',
    '  exit 0',
    'fi',
    'if [ -e "$previous_managed_root" ]; then',
    '  mv "$previous_managed_root" "$managed_root" || true',
    'fi',
    'exit 1',
  ].join('\n');
}

function gatewayServiceStatusScript(rootShell: string): string {
  return [
    'set -eu',
    rootShell,
    managedGatewayPathShell(),
    'if [ ! -x "$binary" ]; then',
    '  printf \'{"status":"not_running","state_root":"%s","error_message":"Gateway service binary is not installed."}\\n\' "$state_root"',
    '  exit 0',
    'fi',
    'if "$binary" service-status --state-root "$state_root"; then',
    '  exit 0',
    'fi',
    'code="$?"',
    'if [ "$code" = "1" ]; then',
    '  exit 0',
    'fi',
    'exit "$code"',
  ].join('\n');
}

function gatewayServiceStartScript(rootShell: string): string {
  return [
    'set -eu',
    rootShell,
    managedGatewayPathShell(),
    'exec "$binary" service-start --state-root "$state_root" --enable-profile-write',
  ].join('\n');
}

function gatewayServiceStopScript(rootShell: string): string {
  return [
    'set -eu',
    rootShell,
    managedGatewayPathShell(),
    'if [ ! -x "$binary" ]; then',
    '  printf \'{"status":"not_running","state_root":"%s"}\\n\' "$state_root"',
    '  exit 0',
    'fi',
    'exec "$binary" service-stop --state-root "$state_root"',
  ].join('\n');
}

function commandForPlacement(
  placement: DesktopRuntimePlacement,
  script: string,
  args: readonly string[],
): readonly string[] {
  const argv = ['sh', '-c', script, 'redeven-gateway-service', ...args];
  if (placement.kind === 'host_process') {
    return argv;
  }
  return containerRuntimeExecCommand({
    engine: placement.container_engine,
    container_id: placement.container_id,
    argv,
  });
}

function rootShellForPlacement(placement: DesktopRuntimePlacement): string {
  return placement.kind === 'host_process'
    ? [hostRootShell('runtime_root'), hostStateShell()].join('\n')
    : containerRootShell();
}

function executorFor(options: GatewayServiceHostOptions): RuntimeHostAccessExecutor {
  return createSSHRuntimeHostExecutor(options.target, { sshPassword: options.sshPassword });
}

function normalizeStatusLineTag(raw: string | undefined): string | null {
  const clean = compact(raw);
  if (clean === '') {
    return null;
  }
  return clean.startsWith('v') ? clean : `v${clean}`;
}

function parseProbeLines(raw: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of String(raw ?? '').split(/\r?\n/u)) {
    const clean = line.trim();
    if (clean === '') {
      continue;
    }
    const index = clean.indexOf('=');
    if (index <= 0) {
      continue;
    }
    values.set(clean.slice(0, index), clean.slice(index + 1));
  }
  return values;
}

function normalizePackageProbeStatus(value: string): GatewayServicePackageProbeStatus {
  switch (compact(value)) {
    case 'ready':
    case 'missing_binary':
    case 'binary_not_executable':
    case 'version_command_failed':
    case 'version_output_invalid':
    case 'slot_version_mismatch':
    case 'stamp_missing':
    case 'stamp_invalid':
      return compact(value) as GatewayServicePackageProbeStatus;
    default:
      throw new Error(`Desktop received an unknown Gateway package probe status: ${value}`);
  }
}

function parseGatewayPackageProbe(raw: string): GatewayPackageProbe {
  const values = parseProbeLines(raw);
  const status = normalizePackageProbeStatus(values.get('status') ?? '');
  const binaryPath = compact(values.get('binary_path'));
  const stampPath = compact(values.get('stamp_path'));
  if (binaryPath === '') {
    throw new Error('Gateway package probe did not include a binary path.');
  }
  if (stampPath === '') {
    throw new Error('Gateway package probe did not include a stamp path.');
  }
  return {
    status,
    binary_path: binaryPath,
    stamp_path: stampPath,
    slot_release_tag: normalizeStatusLineTag(values.get('slot_release_tag')),
    reported_release_tag: normalizeStatusLineTag(values.get('reported_release_tag')),
    target_release_tag: normalizeStatusLineTag(values.get('target_release_tag')),
    reason: compact(values.get('reason')) || gatewayPackageProbeFallbackReason(status),
  };
}

function gatewayPackageProbeFallbackReason(status: GatewayServicePackageProbeStatus): string {
  switch (status) {
    case 'ready':
      return 'desktop-managed Gateway slot is ready';
    case 'missing_binary':
      return 'managed Gateway binary is missing';
    case 'binary_not_executable':
      return 'managed Gateway binary is not executable';
    case 'version_command_failed':
      return 'managed Gateway failed to report its version';
    case 'version_output_invalid':
      return 'managed Gateway returned an invalid version string';
    case 'slot_version_mismatch':
      return 'managed Gateway stamp release does not match the installed binary';
    case 'stamp_missing':
      return 'managed Gateway stamp is missing';
    case 'stamp_invalid':
      return 'managed Gateway stamp is invalid';
  }
}

function describeGatewayPackageProbe(probe: GatewayPackageProbe): string {
  if (probe.status === 'ready') {
    return `Desktop-managed Gateway at ${probe.binary_path} is ready (${probe.reported_release_tag ?? probe.slot_release_tag ?? 'unknown version'}).`;
  }
  if (probe.status === 'slot_version_mismatch') {
    return `Managed Gateway at ${probe.binary_path} reports ${probe.reported_release_tag ?? 'an unknown version'}, but Desktop expects ${probe.target_release_tag ?? 'the current release'}.`;
  }
  return `${probe.reason} (${probe.binary_path}).`;
}

function parseGatewayServiceCommandStatus(raw: string, stateRoot: string): GatewayServiceCommandStatus {
  const lines = String(raw ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { status: 'not_running', state_root: stateRoot };
  }
  const parsed = JSON.parse(lines[lines.length - 1] ?? '{}') as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gateway service status response was not a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  return {
    status: compact(record.status) || 'not_running',
    pid: Number.isInteger(Number(record.pid)) ? Number(record.pid) : undefined,
    listen: compact(record.listen) || undefined,
    state_root: compact(record.state_root) || stateRoot,
    error_message: compact(record.error_message) || undefined,
  };
}

async function probeGatewayPackage(options: GatewayServiceHostOptions): Promise<GatewayPackageProbe> {
  const executor = executorFor(options);
  const rootShell = rootShellForPlacement(options.placement);
  const result = await executor.run(commandForPlacement(options.placement, gatewayProbeCommandScript(rootShell), [
    options.placement.runtime_root,
    options.stateRoot,
    normalizeReleaseTag(options.releaseTag),
  ]), { signal: options.signal });
  return parseGatewayPackageProbe(result.stdout);
}

async function probeGatewayPlatform(options: GatewayServiceHostOptions): Promise<DesktopSSHRemotePlatform> {
  const executor = executorFor(options);
  if (options.placement.kind === 'container_process') {
    const result = await executor.run(containerRuntimePlatformProbeCommand({
      engine: options.placement.container_engine,
      container_id: options.placement.container_id,
    }), { signal: options.signal });
    return parseContainerPlatformProbeOutput(result.stdout);
  }
  const result = await executor.run(['sh', '-c', 'set -eu\nuname -s\nuname -m'], { signal: options.signal });
  const lines = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Gateway target platform probe did not include operating system and architecture.');
  }
  return resolveDesktopSSHRemotePlatform(lines[0] ?? '', lines[1] ?? '');
}

async function installGatewayPackage(options: GatewayServiceHostOptions, platform: DesktopSSHRemotePlatform): Promise<void> {
  options.onProgress?.({
    phase: 'preparing_gateway_package',
    title: 'Preparing Gateway package',
    detail: `Desktop is locating the ${platform.platform_label} Redeven Gateway ${normalizeReleaseTag(options.releaseTag)} package for upload.`,
  });
  const asset = await prepareDesktopRuntimeUploadAsset({
    runtimeReleaseTag: options.releaseTag,
    releaseBaseURL: options.releaseBaseURL || DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
    assetCacheRoot: options.assetCacheRoot,
    packageKind: 'gateway',
    sourceRuntimeRoot: options.sourceRuntimeRoot,
    platform,
    fetchPolicy: runtimeReleaseFetchPolicy(45_000, options.signal),
    signal: options.signal,
  });
  options.onProgress?.({
    phase: 'installing_gateway',
    title: 'Installing Gateway package',
    detail: `Desktop is uploading Redeven Gateway ${normalizeReleaseTag(options.releaseTag)} to the target.`,
  });
  const executor = executorFor(options);
  const rootShell = rootShellForPlacement(options.placement);
  await executor.run(commandForPlacement(options.placement, gatewayUploadedInstallScript(rootShell), [
    options.placement.runtime_root,
    options.stateRoot,
    normalizeReleaseTag(options.releaseTag),
  ]), {
    stdinData: asset.archiveData,
    signal: options.signal,
  });
}

export function gatewayServiceBinaryPath(placement: DesktopRuntimePlacement): string {
  const root = compact(placement.runtime_root) || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  return `${root.replace(/\/+$/u, '')}/gateway/managed/bin/redeven-gateway`;
}

export async function probeManagedGatewayServiceStatus(options: GatewayServiceHostOptions): Promise<GatewayServiceProbe> {
  options.onProgress?.({
    phase: options.placement.kind === 'container_process' ? 'checking_container' : 'checking_host',
    title: options.placement.kind === 'container_process' ? 'Checking Gateway container' : 'Checking Gateway host',
    detail: options.placement.kind === 'container_process'
      ? 'Desktop is checking the container that hosts this Gateway service.'
      : 'Desktop is checking the SSH host that runs this Gateway service.',
  });
  const packageProbe = await probeGatewayPackage(options);
  if (packageProbe.status !== 'ready') {
    return {
      status: 'needs_update',
      message: describeGatewayPackageProbe(packageProbe),
      binary_path: packageProbe.binary_path,
      state_root: options.stateRoot,
      package_status: packageProbe.status,
    };
  }
  const executor = executorFor(options);
  const rootShell = rootShellForPlacement(options.placement);
  const result = await executor.run(commandForPlacement(options.placement, gatewayServiceStatusScript(rootShell), [
    options.placement.runtime_root,
    options.stateRoot,
    normalizeReleaseTag(options.releaseTag),
  ]), { signal: options.signal });
  const status = parseGatewayServiceCommandStatus(result.stdout, options.stateRoot);
  if (status.status === 'running') {
    return {
      status: 'running',
      message: 'Gateway service is running.',
      binary_path: packageProbe.binary_path,
      state_root: status.state_root ?? options.stateRoot,
      pid: status.pid,
      listen: status.listen,
      package_status: packageProbe.status,
    };
  }
  if (status.status === 'not_running') {
    return {
      status: 'not_running',
      message: status.error_message || 'Gateway service is not running.',
      binary_path: packageProbe.binary_path,
      state_root: status.state_root ?? options.stateRoot,
      package_status: packageProbe.status,
    };
  }
  return {
    status: 'failed',
    message: status.error_message || `Gateway service reported ${status.status}.`,
    binary_path: packageProbe.binary_path,
    state_root: status.state_root ?? options.stateRoot,
    package_status: packageProbe.status,
  };
}

export async function ensureManagedGatewayServiceReady(options: GatewayServiceHostOptions): Promise<string> {
  const releaseTag = normalizeReleaseTag(options.releaseTag);
  const initialProbe = await probeGatewayPackage(options).catch(() => null);
  if (options.forceUpdate === true || initialProbe?.status !== 'ready') {
    const platform = await probeGatewayPlatform(options);
    await installGatewayPackage(options, platform);
    const installedProbe = await probeGatewayPackage(options);
    if (installedProbe.status !== 'ready') {
      throw new Error(describeGatewayPackageProbe(installedProbe));
    }
  }
  options.onProgress?.({
    phase: 'starting_gateway',
    title: 'Starting Gateway service',
    detail: `Desktop is starting Redeven Gateway ${releaseTag} on the target.`,
  });
  const executor = executorFor(options);
  const rootShell = rootShellForPlacement(options.placement);
  await executor.run(commandForPlacement(options.placement, gatewayServiceStartScript(rootShell), [
    options.placement.runtime_root,
    options.stateRoot,
    releaseTag,
  ]), { signal: options.signal });
  options.onProgress?.({
    phase: 'gateway_ready',
    title: 'Gateway service ready',
    detail: 'Desktop can now open a Gateway bridge and sync the catalog.',
  });
  return gatewayServiceBinaryPath(options.placement);
}

export async function stopManagedGatewayService(options: GatewayServiceHostOptions): Promise<void> {
  options.onProgress?.({
    phase: 'stopping_gateway',
    title: 'Stopping Gateway service',
    detail: 'Desktop is stopping the managed Gateway service on the target.',
  });
  const executor = executorFor(options);
  const rootShell = rootShellForPlacement(options.placement);
  await executor.run(commandForPlacement(options.placement, gatewayServiceStopScript(rootShell), [
    options.placement.runtime_root,
    options.stateRoot,
    normalizeReleaseTag(options.releaseTag),
  ]), { signal: options.signal });
  options.onProgress?.({
    phase: 'verifying_gateway_stopped',
    title: 'Verifying Gateway stopped',
    detail: 'Desktop is confirming that the managed Gateway service has stopped.',
  });
  const probe = await probeManagedGatewayServiceStatus(options).catch(() => null);
  if (probe?.status === 'running') {
    throw new Error('Desktop could not stop the Gateway service because it still reports running.');
  }
}

export function gatewayReleasePackageName(platform: DesktopSSHRemotePlatform): string {
  return desktopSSHReleasePackageName(platform, 'gateway');
}

export function gatewayReleasePackageURL(rawReleaseBaseURL: string, releaseTag: string, platform: DesktopSSHRemotePlatform): string {
  return buildDesktopSSHReleaseAssetURL(rawReleaseBaseURL, normalizeReleaseTag(releaseTag), gatewayReleasePackageName(platform));
}
