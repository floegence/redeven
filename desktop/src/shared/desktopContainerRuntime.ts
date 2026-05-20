import {
  normalizeDesktopContainerEngine,
  normalizeDesktopRuntimeHostAccess,
  type DesktopContainerEngine,
  type DesktopRuntimeHostAccess,
} from './desktopRuntimePlacement';
import {
  normalizeDesktopOperationFailurePresentation,
  type DesktopOperationFailurePresentation,
} from './desktopOperationFailure';

export const DESKTOP_LAUNCHER_LIST_RUNTIME_CONTAINERS_CHANNEL = 'redeven-desktop:launcher-list-runtime-containers';

export type DesktopRuntimeContainerOption = Readonly<{
  engine: DesktopContainerEngine;
  container_id: string;
  container_ref: string;
  container_label: string;
  image: string;
  status_text: string;
}>;

export type DesktopRuntimeContainerListRequest = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  engine: DesktopContainerEngine;
}>;

export type DesktopRuntimeContainerListResponse =
  | Readonly<{
      ok: true;
      containers: readonly DesktopRuntimeContainerOption[];
    }>
  | Readonly<{
      ok: false;
      message: string;
      failure?: DesktopOperationFailurePresentation;
    }>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopRuntimeContainerOption(value: unknown): DesktopRuntimeContainerOption | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  let engine: DesktopContainerEngine;
  try {
    engine = normalizeDesktopContainerEngine(record.engine);
  } catch {
    return null;
  }
  const containerID = compact(record.container_id);
  if (containerID === '') {
    return null;
  }
  const containerLabel = compact(record.container_label) || containerID.slice(0, 12);
  return {
    engine,
    container_id: containerID,
    container_ref: compact(record.container_ref) || containerLabel || containerID,
    container_label: containerLabel,
    image: compact(record.image),
    status_text: compact(record.status_text),
  };
}

export function normalizeDesktopRuntimeContainerListRequest(
  value: unknown,
): DesktopRuntimeContainerListRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  try {
    return {
      host_access: normalizeDesktopRuntimeHostAccess(record.host_access),
      engine: normalizeDesktopContainerEngine(record.engine),
    };
  } catch {
    return null;
  }
}

export function normalizeDesktopRuntimeContainerListResponse(
  value: unknown,
): DesktopRuntimeContainerListResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop could not list containers.',
    };
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true) {
    const failure = normalizeDesktopOperationFailurePresentation(record.failure);
    const message = failure?.summary || compact(record.message) || 'Desktop could not list containers.';
    return {
      ok: false,
      message,
      ...(failure ? { failure } : {}),
    };
  }
  const containers = Array.isArray(record.containers)
    ? record.containers
      .map(normalizeDesktopRuntimeContainerOption)
      .filter((item): item is DesktopRuntimeContainerOption => item !== null)
    : [];
  return {
    ok: true,
    containers,
  };
}
