import type { DesktopContainerEngine } from '../shared/desktopRuntimePlacement';
import {
  desktopRuntimeContainerReference,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import {
  buildManagedSSHActivatePreparedRuntimeScript,
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHUploadedInstallScript,
} from './sshRuntime';
import {
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';
import {
  desktopHostCommandNotFoundMessage,
  isDesktopHostCommandNotFoundError,
} from './desktopHostCommand';

export type DesktopContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'missing'
  | 'no_permission';

export type DesktopRuntimeContainerUnavailableStatus =
  | Exclude<DesktopContainerRuntimeStatus, 'running'>
  | 'ambiguous'
  | 'command_not_found'
  | 'engine_unavailable';

type ContainerProcessPlacement = Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;

export type DesktopContainerInspectResult = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  status: DesktopContainerRuntimeStatus;
}>;

export function containerRuntimeRootShellPrelude(variableName = 'runtime_root'): string {
  return [
    `if [ "$${variableName}" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  if [ -z "${HOME:-}" ]; then',
    '    echo "container HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '    exit 1',
    '  fi',
    `  ${variableName}="\${HOME%/}/.redeven"`,
    'fi',
    `case "$${variableName}" in`,
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "container HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    ${variableName}="\${HOME%/}/.redeven/\${${variableName}#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
  ].join('\n');
}

export type DesktopRuntimeContainerListItem = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  image: string;
  status_text: string;
}>;

export type DesktopContainerRuntimePlatform = DesktopSSHRemotePlatform;

export type DesktopResolvedRuntimeContainerPlacement = Readonly<{
  status: 'running';
  inspected: DesktopContainerInspectResult;
  placement: ContainerProcessPlacement;
  changed: boolean;
}>;

export type DesktopRuntimeContainerResolution = DesktopResolvedRuntimeContainerPlacement | Readonly<{
  status: DesktopRuntimeContainerUnavailableStatus;
  message: string;
}>;

export type DesktopRuntimeContainerResolver = Readonly<{
  inspect: (engine: DesktopContainerEngine, containerRef: string) => Promise<DesktopContainerInspectResult>;
  listRunning: (engine: DesktopContainerEngine) => Promise<readonly DesktopRuntimeContainerListItem[]>;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeContainerEngine(value: unknown): DesktopContainerEngine {
  const clean = compact(value).toLowerCase();
  if (clean === 'docker' || clean === 'podman') {
    return clean;
  }
  throw new Error('Container engine must be Docker or Podman.');
}

function normalizeContainerStatus(value: unknown): DesktopContainerRuntimeStatus {
  const clean = compact(value).toLowerCase();
  switch (clean) {
    case 'running':
      return 'running';
    case 'created':
    case 'exited':
    case 'paused':
    case 'restarting':
    case 'dead':
    case 'stopped':
      return 'stopped';
    default:
      return 'missing';
  }
}

function containerNameLabel(value: unknown): string {
  const clean = compact(value).replace(/^\/+/u, '');
  return clean;
}

function containerListNameLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(containerNameLabel).filter(Boolean)[0] ?? '';
  }
  return containerNameLabel(value).split(',').map((part) => part.trim()).find(Boolean) ?? '';
}

function inspectRecordFromArrayPayload(raw: string): Record<string, unknown> | null {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed[0] && typeof parsed[0] === 'object'
      ? parsed[0] as Record<string, unknown>
      : null;
  }
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : null;
}

export function parseContainerInspectJSON(
  engine: DesktopContainerEngine,
  rawJSON: string,
): DesktopContainerInspectResult {
  const record = inspectRecordFromArrayPayload(rawJSON);
  if (!record) {
    throw new Error('Container inspect output did not include a container record.');
  }
  const id = compact(record.Id);
  if (id === '') {
    throw new Error('Container inspect output did not include a concrete container ID.');
  }
  const name = containerNameLabel(record.Name);
  const state = record.State && typeof record.State === 'object'
    ? record.State as Record<string, unknown>
    : {};
  return {
    engine,
    container_id: id,
    container_ref: name || id,
    container_label: name || id.slice(0, 12),
    status: state.Running === true ? 'running' : normalizeContainerStatus(state.Status),
  };
}

function parseContainerListLine(
  engine: DesktopContainerEngine,
  line: string,
): DesktopRuntimeContainerListItem | null {
  const record = JSON.parse(line) as unknown;
  if (!record || typeof record !== 'object') {
    return null;
  }
  const value = record as Record<string, unknown>;
  const id = compact(value.ID ?? value.Id ?? value.id);
  if (id === '') {
    return null;
  }
  const label = containerListNameLabel(value.Names ?? value.names ?? value.Name ?? value.name);
  return {
    engine,
    container_id: id,
    container_ref: label || id,
    container_label: label || id.slice(0, 12),
    image: compact(value.Image ?? value.image),
    status_text: compact(value.Status ?? value.status),
  };
}

export function parseContainerListOutput(
  engine: DesktopContainerEngine,
  rawOutput: string,
): readonly DesktopRuntimeContainerListItem[] {
  const containers: DesktopRuntimeContainerListItem[] = [];
  const seen = new Set<string>();
  for (const line of String(rawOutput ?? '').split(/\r?\n/u)) {
    const cleanLine = line.trim();
    if (cleanLine === '') {
      continue;
    }
    const item = parseContainerListLine(engine, cleanLine);
    if (!item || seen.has(item.container_id)) {
      continue;
    }
    seen.add(item.container_id);
    containers.push(item);
  }
  containers.sort((left, right) => left.container_label.localeCompare(right.container_label));
  return containers;
}

export function containerInspectCommand(
  engine: DesktopContainerEngine,
  containerRef: string,
): readonly string[] {
  const normalizedEngine = normalizeContainerEngine(engine);
  const ref = compact(containerRef);
  if (ref === '') {
    throw new Error('Container reference is required.');
  }
  return [normalizedEngine, 'inspect', ref];
}

export function containerListCommand(
  engine: DesktopContainerEngine,
): readonly string[] {
  const normalizedEngine = normalizeContainerEngine(engine);
  return [normalizedEngine, 'ps', '--no-trunc', '--format', '{{json .}}'];
}

function resolvedContainerPlacement(
  placement: ContainerProcessPlacement,
  inspected: DesktopContainerInspectResult,
): ContainerProcessPlacement {
  return {
    ...placement,
    container_id: inspected.container_id,
    container_ref: desktopRuntimeContainerReference(placement),
    container_label: inspected.container_label || placement.container_label,
  };
}

function placementChanged(
  left: ContainerProcessPlacement,
  right: ContainerProcessPlacement,
): boolean {
  return left.container_id !== right.container_id
    || left.container_ref !== right.container_ref
    || left.container_label !== right.container_label;
}

export function containerRuntimeUnavailableMessage(
  placement: ContainerProcessPlacement,
  status: DesktopRuntimeContainerUnavailableStatus,
): string {
  const label = placement.container_label || desktopRuntimeContainerReference(placement);
  const engine = placement.container_engine === 'podman' ? 'Podman' : 'Docker';
  const command = placement.container_engine === 'podman' ? 'podman' : 'docker';
  if (status === 'command_not_found') {
    return desktopHostCommandNotFoundMessage(command);
  }
  if (status === 'engine_unavailable') {
    return `${engine} is unavailable. Make sure ${engine} is running and the ${command} CLI can reach it, then refresh and try again.`;
  }
  if (status === 'missing') {
    return `Container ${label} was not found. Choose a running container, then try again.`;
  }
  if (status === 'no_permission') {
    return `Desktop does not have permission to inspect ${label}. Check ${placement.container_engine} access, then try again.`;
  }
  if (status === 'ambiguous') {
    return `Container reference ${label} matches more than one running container. Choose the exact container, then try again.`;
  }
  return `Container ${label} is not running. Start it outside Redeven, then refresh and try again.`;
}

export function containerRuntimeCommandFailureStatus(
  error: unknown,
): Exclude<DesktopRuntimeContainerUnavailableStatus, 'stopped' | 'ambiguous'> {
  if (isDesktopHostCommandNotFoundError(error)) {
    return 'command_not_found';
  }
  const record = error && typeof error === 'object'
    ? error as {
        message?: unknown;
        presentation?: {
          diagnostics?: readonly { text?: unknown }[];
        };
        cause?: unknown;
      }
    : null;
  const diagnosticText = record?.presentation?.diagnostics
    ?.map((item) => compact(item.text))
    .filter(Boolean)
    .join('\n') ?? '';
  const causeText = record?.cause instanceof Error ? record.cause.message : '';
  const message = [
    error instanceof Error ? error.message : String(error ?? ''),
    diagnosticText,
    causeText,
  ].filter((part) => compact(part) !== '').join('\n');
  const commandNotFoundPattern = /\b(docker|podman)\s+cli was not found\b|\bspawn\s+(docker|podman)\s+enoent\b|\b(docker|podman)\b.*\benoent\b/iu;
  if (commandNotFoundPattern.test(message)) {
    return 'command_not_found';
  }
  if (/permission denied|access denied|unauthorized|forbidden|operation not permitted/iu.test(message)) {
    return 'no_permission';
  }
  if (/no such (object|container)|not found|does not exist|no container with/iu.test(message)) {
    return 'missing';
  }
  return 'engine_unavailable';
}

function listItemMatchesReference(item: DesktopRuntimeContainerListItem, reference: string): boolean {
  const cleanReference = compact(reference);
  if (cleanReference === '') {
    return false;
  }
  const referenceCanBeContainerID = /^[a-f0-9]{6,}$/iu.test(cleanReference);
  return item.container_id === cleanReference
    || item.container_ref === cleanReference
    || item.container_label === cleanReference
    || (referenceCanBeContainerID && item.container_id.startsWith(cleanReference));
}

function inspectedContainerMatchesReference(
  inspected: DesktopContainerInspectResult,
  placement: ContainerProcessPlacement,
): boolean {
  const reference = desktopRuntimeContainerReference(placement);
  if (reference === placement.container_id) {
    return true;
  }
  return listItemMatchesReference({
    engine: inspected.engine,
    container_id: inspected.container_id,
    container_ref: inspected.container_ref,
    container_label: inspected.container_label,
    image: '',
    status_text: '',
  }, reference);
}

export async function resolveRuntimeContainerPlacement(
  resolver: DesktopRuntimeContainerResolver,
  placement: ContainerProcessPlacement,
): Promise<DesktopRuntimeContainerResolution> {
  try {
    const inspected = await resolver.inspect(placement.container_engine, placement.container_id);
    if (inspected.status !== 'running') {
      return {
        status: inspected.status,
        message: containerRuntimeUnavailableMessage(placement, inspected.status),
      };
    }
    if (inspectedContainerMatchesReference(inspected, placement)) {
      const nextPlacement = resolvedContainerPlacement(placement, inspected);
      return {
        status: 'running',
        inspected,
        placement: nextPlacement,
        changed: placementChanged(placement, nextPlacement),
      };
    }
  } catch (error) {
    const directStatus = containerRuntimeCommandFailureStatus(error);
    if (directStatus !== 'missing') {
      return {
        status: directStatus,
        message: containerRuntimeUnavailableMessage(placement, directStatus),
      };
    }
  }

  const reference = desktopRuntimeContainerReference(placement);
  let containers: readonly DesktopRuntimeContainerListItem[];
  try {
    containers = await resolver.listRunning(placement.container_engine);
  } catch (error) {
    const status = containerRuntimeCommandFailureStatus(error);
    return {
      status,
      message: containerRuntimeUnavailableMessage(placement, status),
    };
  }
  const matches = containers.filter((item) => listItemMatchesReference(item, reference));
  if (matches.length === 0) {
    return {
      status: 'missing',
      message: containerRuntimeUnavailableMessage(placement, 'missing'),
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      message: containerRuntimeUnavailableMessage(placement, 'ambiguous'),
    };
  }
  const [match] = matches;
  const inspected: DesktopContainerInspectResult = {
    engine: match.engine,
    container_id: match.container_id,
    container_ref: match.container_ref,
    container_label: match.container_label,
    status: 'running',
  };
  const nextPlacement = resolvedContainerPlacement(placement, inspected);
  return {
    status: 'running',
    inspected,
    placement: nextPlacement,
    changed: true,
  };
}

export function parseContainerPlatformProbeOutput(rawOutput: string): DesktopContainerRuntimePlatform {
  const lines = String(rawOutput ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) {
    throw new Error('Container platform probe output did not include operating system and architecture.');
  }
  const platform = resolveDesktopSSHRemotePlatform(lines[0], lines[1]);
  if (platform.goos !== 'linux') {
    throw new Error(`Container runtime targets require a Linux container, but detected ${platform.platform_label}.`);
  }
  return platform;
}

// IMPORTANT: Container lifecycle belongs to the user's container tooling.
// Desktop may list, inspect, and exec into running containers, but it must not
// build docker/podman start or stop commands for runtime target management.
export function containerRuntimeExecCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}>): readonly string[] {
  return containerRuntimeExecCommandWithMode(input, { detached: false, interactive: true });
}

function containerRuntimeExecCommandWithMode(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}>, mode: Readonly<{
  detached: boolean;
  interactive: boolean;
}>): readonly string[] {
  const normalizedEngine = normalizeContainerEngine(input.engine);
  const containerID = compact(input.container_id);
  if (containerID === '') {
    throw new Error('Container ID is required.');
  }
  if (input.argv.length === 0 || input.argv.some((part) => compact(part) === '')) {
    throw new Error('Container exec argv must be non-empty.');
  }
  const envArgs = Object.entries(input.env ?? {})
    .map(([key, value]) => [compact(key), value] as const)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
    .flatMap(([key, value]) => ['--env', value == null ? key : `${key}=${String(value)}`]);
  return [
    normalizedEngine,
    'exec',
    ...(mode.detached ? ['-d'] : []),
    ...(mode.interactive ? ['-i'] : []),
    ...envArgs,
    containerID,
    ...input.argv.map((part) => compact(part)),
  ];
}

export function containerRuntimePlatformProbeCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
}>): readonly string[] {
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: ['sh', '-c', 'set -eu\nuname -s\nuname -m'],
  });
}

export function containerRuntimeProbeCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_root: string;
  runtime_release_tag: string;
}>): readonly string[] {
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      'sh',
      '-c',
      buildManagedSSHRuntimeProbeScript(),
      'redeven-container-runtime-probe',
      input.runtime_root,
      input.runtime_release_tag,
    ],
  });
}

export function containerRuntimeUploadedInstallCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_root: string;
  runtime_release_tag: string;
}>): readonly string[] {
  const installDriver = [
    'set -eu',
    'runtime_root="$1"',
    containerRuntimeRootShellPrelude(),
    'release_tag="$2"',
    'prepare_script="$3"',
    'activate_script="$4"',
    'upload_dir="$(mktemp -d "${TMPDIR:-/tmp}/redeven-container-upload.XXXXXX")"',
    'archive_path="${upload_dir}/redeven.tar.gz"',
    'staging_root=""',
    'cleanup() {',
    '  rm -rf "$upload_dir"',
    '  if [ -n "$staging_root" ]; then rm -rf "$staging_root"; fi',
    '}',
    'trap cleanup EXIT INT TERM',
    'cat > "$archive_path"',
    'staging_root="$(sh -c "$prepare_script" redeven-container-upload-prepare "$runtime_root" "$release_tag" "$archive_path" "$upload_dir")"',
    'sh -c "$activate_script" redeven-container-upload-activate "$runtime_root" "$release_tag" "$staging_root"',
    'staging_root=""',
  ].join('\n');
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      'sh',
      '-c',
      installDriver,
      'redeven-container-upload-driver',
      input.runtime_root,
      input.runtime_release_tag,
      buildManagedSSHUploadedInstallScript(),
      buildManagedSSHActivatePreparedRuntimeScript(),
    ],
  });
}

export function containerRuntimeDaemonStartCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
  runtime_state_root?: string;
  desktop_owner_id: string;
}>): readonly string[] {
  const startDriver = [
    'set -eu',
    'state_root="$1"',
    containerRuntimeRootShellPrelude('state_root'),
    'runtime_root="$2"',
    containerRuntimeRootShellPrelude('runtime_root'),
    'runtime_binary_path="$3"',
    `if [ "$runtime_binary_path" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  runtime_binary_path="${runtime_root%/}/runtime/managed/bin/redeven"',
    'fi',
    `case "$runtime_binary_path" in`,
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "container HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    runtime_binary_path="\${HOME%/}/.redeven/\${runtime_binary_path#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'exec "$runtime_binary_path" run --mode desktop --desktop-managed --presentation machine --state-root "$state_root" --local-ui-bind 127.0.0.1:0',
  ].join('\n');
  return containerRuntimeExecCommandWithMode({
    engine: input.engine,
    container_id: input.container_id,
    env: {
      REDEVEN_DESKTOP_OWNER_ID: input.desktop_owner_id,
    },
    argv: [
      'sh',
      '-c',
      startDriver,
      'redeven-container-runtime-start',
      input.runtime_state_root ?? input.runtime_root,
      input.runtime_root,
      input.runtime_binary_path,
    ],
  }, { detached: true, interactive: false });
}

export function containerRuntimeDaemonStatusCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
  runtime_state_root?: string;
}>): readonly string[] {
  const statusDriver = [
    'set -eu',
    'state_root="$1"',
    containerRuntimeRootShellPrelude('state_root'),
    'runtime_root="$2"',
    containerRuntimeRootShellPrelude('runtime_root'),
    'runtime_binary_path="$3"',
    `if [ "$runtime_binary_path" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  runtime_binary_path="${runtime_root%/}/runtime/managed/bin/redeven"',
    'fi',
    `case "$runtime_binary_path" in`,
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "container HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    runtime_binary_path="\${HOME%/}/.redeven/\${runtime_binary_path#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'if [ ! -x "$runtime_binary_path" ]; then',
    `  printf '%s\\n' '{"status":"blocked","code":"not_running","message":"Runtime daemon is not running."}'`,
    '  exit 0',
    'fi',
    'exec "$runtime_binary_path" desktop-runtime-status --state-root "$state_root"',
  ].join('\n');
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      'sh',
      '-c',
      statusDriver,
      'redeven-container-runtime-status',
      input.runtime_state_root ?? input.runtime_root,
      input.runtime_root,
      input.runtime_binary_path,
    ],
  });
}

export const CONTAINER_RUNTIME_PROCESS_COMMAND_EXIT_MARKER = '__REDEVEN_RUNTIME_PROCESS_EXIT__=';

export function containerRuntimeProcessHelperCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
  runtime_state_root?: string;
  desktop_owner_id: string;
  operation: 'inventory' | 'stop';
  inventory_digest?: string;
  grace_period_seconds?: number;
  reconciliation_mode?: 'automatic' | 'confirmed_takeover';
}>): readonly string[] {
  const helperDriver = [
    'set -eu',
    'state_root="$1"',
    containerRuntimeRootShellPrelude('state_root'),
    'runtime_root="$2"',
    containerRuntimeRootShellPrelude('runtime_root'),
    'managed_binary="$3"',
    `if [ "$managed_binary" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`,
    '  managed_binary="${runtime_root%/}/runtime/managed/bin/redeven"',
    'fi',
    `case "$managed_binary" in`,
    `  ${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/*)`,
    '    if [ -z "${HOME:-}" ]; then',
    '      echo "container HOME is unavailable; set Runtime Root to an absolute .redeven path" >&2',
    '      exit 1',
    '    fi',
    `    managed_binary="\${HOME%/}/.redeven/\${managed_binary#${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/}"`,
    '    ;;',
    'esac',
    'desktop_owner_id="$4"',
    'operation="$5"',
    'inventory_digest="${6:-}"',
    'grace_period="${7:-5s}"',
    'reconciliation_mode="${8:-automatic}"',
    'helper_root="$(mktemp -d "${TMPDIR:-/tmp}/redeven-runtime-process-helper.XXXXXX")"',
    'archive_path="${helper_root}/runtime.tar.gz"',
    'output_path="${helper_root}/output"',
    'error_path="${helper_root}/error"',
    'cleanup() { rm -rf "$helper_root"; }',
    'trap cleanup EXIT INT TERM',
    'cat > "$archive_path"',
    'tar -xzf "$archive_path" -C "$helper_root"',
    'helper_binary="${helper_root}/redeven"',
    'if [ ! -x "$helper_binary" ]; then',
    '  echo "Desktop runtime process helper is missing redeven" >&2',
    '  exit 1',
    'fi',
    'set +e',
    'case "$operation" in',
    '  inventory)',
    '    "$helper_binary" desktop-runtime-inventory --runtime-root "$runtime_root" --state-root "$state_root" --desktop-owner-id "$desktop_owner_id" --current-executable "$managed_binary" >"$output_path" 2>"$error_path"',
    '    exit_code=$?',
    '    ;;',
    '  stop)',
    '    "$helper_binary" desktop-runtime-stop --runtime-root "$runtime_root" --state-root "$state_root" --desktop-owner-id "$desktop_owner_id" --current-executable "$managed_binary" --reconciliation-mode "$reconciliation_mode" --all-matching --expected-inventory-digest "$inventory_digest" --grace-period "$grace_period" --json >"$output_path" 2>"$error_path"',
    '    exit_code=$?',
    '    ;;',
    '  *)',
    '    printf "%s\\n" "runtime helper operation is invalid" >"$error_path"',
    '    exit_code=2',
    '    ;;',
    'esac',
    'set -e',
    `printf '${CONTAINER_RUNTIME_PROCESS_COMMAND_EXIT_MARKER}%s\\n' "$exit_code"`,
    'cat "$output_path"',
    'cat "$error_path" >&2',
  ].join('\n');
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      'sh',
      '-c',
      helperDriver,
      'redeven-container-runtime-process-helper',
      input.runtime_state_root ?? input.runtime_root,
      input.runtime_root,
      input.runtime_binary_path,
      input.desktop_owner_id,
      input.operation,
      input.inventory_digest || '-',
      `${Math.max(1, Math.ceil(input.grace_period_seconds ?? 5))}s`,
      input.reconciliation_mode ?? 'automatic',
    ],
  });
}
