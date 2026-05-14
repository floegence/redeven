import type {
  DesktopContainerEngine,
  DesktopRuntimeContainerOwner,
} from '../shared/desktopRuntimePlacement';

export type DesktopContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'missing'
  | 'no_permission';

export type DesktopContainerInspectResult = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_label: string;
  owner: DesktopRuntimeContainerOwner;
  status: DesktopContainerRuntimeStatus;
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

function containerOwnerFromLabels(labels: unknown): DesktopRuntimeContainerOwner {
  if (!labels || typeof labels !== 'object') {
    return 'external';
  }
  const record = labels as Record<string, unknown>;
  const owner = compact(record['com.redeven.desktop.container_owner']).toLowerCase();
  const managedBy = compact(record['com.redeven.desktop.managed_by']).toLowerCase();
  return owner === 'desktop' || managedBy === 'redeven-desktop' ? 'desktop' : 'external';
}

function containerNameLabel(value: unknown): string {
  const clean = compact(value).replace(/^\/+/u, '');
  return clean;
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
    throw new Error('Container inspect output did not include a stable container ID.');
  }
  const name = containerNameLabel(record.Name);
  const config = record.Config && typeof record.Config === 'object'
    ? record.Config as Record<string, unknown>
    : {};
  const state = record.State && typeof record.State === 'object'
    ? record.State as Record<string, unknown>
    : {};
  const labels = config.Labels;
  return {
    engine,
    container_id: id,
    container_label: name || id.slice(0, 12),
    owner: containerOwnerFromLabels(labels),
    status: state.Running === true ? 'running' : normalizeContainerStatus(state.Status),
  };
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

export function containerRuntimeExecCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  argv: readonly string[];
}>): readonly string[] {
  const normalizedEngine = normalizeContainerEngine(input.engine);
  const containerID = compact(input.container_id);
  if (containerID === '') {
    throw new Error('Container ID is required.');
  }
  if (input.argv.length === 0 || input.argv.some((part) => compact(part) === '')) {
    throw new Error('Container exec argv must be non-empty.');
  }
  return [normalizedEngine, 'exec', '-i', containerID, ...input.argv.map((part) => compact(part))];
}
