import type { DesktopContainerEngine } from '../shared/desktopRuntimePlacement';

export type DesktopContainerRuntimeStatus =
  | 'running'
  | 'stopped'
  | 'missing'
  | 'no_permission';

export type DesktopContainerInspectResult = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_label: string;
  status: DesktopContainerRuntimeStatus;
}>;

export type DesktopRuntimeContainerListItem = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_label: string;
  image: string;
  status_text: string;
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
    throw new Error('Container inspect output did not include a stable container ID.');
  }
  const name = containerNameLabel(record.Name);
  const state = record.State && typeof record.State === 'object'
    ? record.State as Record<string, unknown>
    : {};
  return {
    engine,
    container_id: id,
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
  return {
    engine,
    container_id: id,
    container_label: containerListNameLabel(value.Names ?? value.names ?? value.Name ?? value.name) || id.slice(0, 12),
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

// IMPORTANT: Container lifecycle belongs to the user's container tooling.
// Desktop may list, inspect, and exec into running containers, but it must not
// build docker/podman start or stop commands for runtime target management.
export function containerRuntimeExecCommand(input: Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
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
  return [normalizedEngine, 'exec', '-i', ...envArgs, containerID, ...input.argv.map((part) => compact(part))];
}
