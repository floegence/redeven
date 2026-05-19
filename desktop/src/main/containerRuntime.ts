import type { DesktopContainerEngine } from '../shared/desktopRuntimePlacement';
import {
  desktopRuntimeContainerReference,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import {
  buildManagedSSHRuntimeProbeScript,
  buildManagedSSHUploadedInstallScript,
} from './sshRuntime';
import {
  resolveDesktopSSHRemotePlatform,
  type DesktopSSHRemotePlatform,
} from './sshReleaseAssets';

export type DesktopContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'missing'
  | 'no_permission';

type ContainerProcessPlacement = Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;

export type DesktopContainerInspectResult = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  status: DesktopContainerRuntimeStatus;
}>;

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
  status: Exclude<DesktopContainerRuntimeStatus, 'running'> | 'ambiguous';
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

function containerUnavailableMessage(
  placement: ContainerProcessPlacement,
  status: DesktopRuntimeContainerResolution['status'],
): string {
  const label = placement.container_label || desktopRuntimeContainerReference(placement);
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

function inspectFailureStatus(error: unknown): Exclude<DesktopContainerRuntimeStatus, 'running' | 'stopped'> {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission denied|access denied|unauthorized|forbidden|operation not permitted/iu.test(message)) {
    return 'no_permission';
  }
  return 'missing';
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
        message: containerUnavailableMessage(placement, inspected.status),
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
    const directStatus = inspectFailureStatus(error);
    if (directStatus === 'no_permission') {
      return {
        status: directStatus,
        message: containerUnavailableMessage(placement, directStatus),
      };
    }
  }

  const reference = desktopRuntimeContainerReference(placement);
  let containers: readonly DesktopRuntimeContainerListItem[];
  try {
    containers = await resolver.listRunning(placement.container_engine);
  } catch (error) {
    const status = inspectFailureStatus(error);
    return {
      status,
      message: containerUnavailableMessage(placement, status),
    };
  }
  const matches = containers.filter((item) => listItemMatchesReference(item, reference));
  if (matches.length === 0) {
    return {
      status: 'missing',
      message: containerUnavailableMessage(placement, 'missing'),
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      message: containerUnavailableMessage(placement, 'ambiguous'),
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
    'release_tag="$2"',
    'install_script="$3"',
    'upload_dir="$(mktemp -d "${TMPDIR:-/tmp}/redeven-container-upload.XXXXXX")"',
    'archive_path="${upload_dir}/redeven.tar.gz"',
    'cleanup() { rm -rf "$upload_dir"; }',
    'trap cleanup EXIT INT TERM',
    'cat > "$archive_path"',
    'sh -c "$install_script" redeven-container-upload-install "$runtime_root" "$release_tag" "$archive_path" "$upload_dir"',
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
    ],
  });
}

export function containerRuntimeDaemonStartCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
  desktop_owner_id: string;
}>): readonly string[] {
  return containerRuntimeExecCommandWithMode({
    engine: input.engine,
    container_id: input.container_id,
    env: {
      REDEVEN_DESKTOP_OWNER_ID: input.desktop_owner_id,
    },
    argv: [
      input.runtime_binary_path,
      'run',
      '--mode',
      'desktop',
      '--desktop-managed',
      '--presentation',
      'machine',
      '--state-root',
      input.runtime_root,
      '--local-ui-bind',
      '127.0.0.1:0',
    ],
  }, { detached: true, interactive: false });
}

export function containerRuntimeDaemonStatusCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
}>): readonly string[] {
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      input.runtime_binary_path,
      'desktop-runtime-status',
      '--state-root',
      input.runtime_root,
    ],
  });
}

export function containerRuntimeDaemonStopCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  runtime_binary_path: string;
  runtime_root: string;
}>): readonly string[] {
  return containerRuntimeExecCommand({
    engine: input.engine,
    container_id: input.container_id,
    argv: [
      input.runtime_binary_path,
      'desktop-runtime-stop',
      '--state-root',
      input.runtime_root,
    ],
  });
}
