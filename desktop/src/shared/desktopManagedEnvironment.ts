import { DEFAULT_DESKTOP_LOCAL_UI_BIND } from './desktopAccessModel';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';

export type DesktopManagedEnvironmentKind = 'local' | 'controlplane';

export type DesktopManagedEnvironmentAccess = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_configured: boolean;
}>;

export type DesktopManagedLocalEnvironment = Readonly<{
  id: string;
  kind: 'local';
  name: string;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  access: DesktopManagedEnvironmentAccess;
}>;

export type DesktopManagedControlPlaneEnvironment = Readonly<{
  id: string;
  kind: 'controlplane';
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  access: DesktopManagedEnvironmentAccess;
}>;

export type DesktopManagedEnvironment = DesktopManagedLocalEnvironment | DesktopManagedControlPlaneEnvironment;

export const DEFAULT_LOCAL_ENVIRONMENT_NAME = 'default';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeIDFragment(value: string): string {
  return compact(value).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

export function normalizeDesktopLocalEnvironmentName(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value).toLowerCase());
  return normalized || DEFAULT_LOCAL_ENVIRONMENT_NAME;
}

export function desktopManagedLocalEnvironmentID(name: string): string {
  return `local:${encodeURIComponent(normalizeDesktopLocalEnvironmentName(name))}`;
}

export function desktopManagedControlPlaneEnvironmentID(providerOrigin: string, envPublicID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = sanitizeIDFragment(envPublicID);
  if (normalizedEnvPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  return `cp:${encodeURIComponent(normalizedOrigin)}:env:${encodeURIComponent(normalizedEnvPublicID)}`;
}

export function defaultDesktopManagedEnvironmentAccess(): DesktopManagedEnvironmentAccess {
  return {
    local_ui_bind: DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: '',
    local_ui_password_configured: false,
  };
}

export function defaultLocalManagedEnvironmentLabel(name: string): string {
  const normalizedName = normalizeDesktopLocalEnvironmentName(name);
  if (normalizedName === DEFAULT_LOCAL_ENVIRONMENT_NAME) {
    return 'Local Environment';
  }
  return normalizedName.split(/[-_.]+/).filter(Boolean).map((segment) => (
    segment.slice(0, 1).toUpperCase() + segment.slice(1)
  )).join(' ') || 'Local Environment';
}

type CreateManagedLocalEnvironmentOptions = Readonly<{
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createManagedLocalEnvironment(
  name: string,
  options: CreateManagedLocalEnvironmentOptions = {},
): DesktopManagedLocalEnvironment {
  const normalizedName = normalizeDesktopLocalEnvironmentName(name);
  const now = Math.max(
    Number(options.createdAtMS ?? Number.NaN) || 0,
    Number(options.updatedAtMS ?? Number.NaN) || 0,
    Number(options.lastUsedAtMS ?? Number.NaN) || 0,
    Date.now(),
  );
  return {
    id: desktopManagedLocalEnvironmentID(normalizedName),
    kind: 'local',
    name: normalizedName,
    label: compact(options.label) || defaultLocalManagedEnvironmentLabel(normalizedName),
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    access: options.access ?? defaultDesktopManagedEnvironmentAccess(),
  };
}

type CreateManagedControlPlaneEnvironmentOptions = Readonly<{
  providerID: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createManagedControlPlaneEnvironment(
  providerOrigin: string,
  envPublicID: string,
  options: CreateManagedControlPlaneEnvironmentOptions,
): DesktopManagedControlPlaneEnvironment {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = sanitizeIDFragment(envPublicID);
  const providerID = compact(options.providerID);
  if (normalizedEnvPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  if (providerID === '') {
    throw new Error('Provider ID is required.');
  }
  const now = Math.max(
    Number(options.createdAtMS ?? Number.NaN) || 0,
    Number(options.updatedAtMS ?? Number.NaN) || 0,
    Number(options.lastUsedAtMS ?? Number.NaN) || 0,
    Date.now(),
  );
  return {
    id: desktopManagedControlPlaneEnvironmentID(normalizedOrigin, normalizedEnvPublicID),
    kind: 'controlplane',
    provider_origin: normalizedOrigin,
    provider_id: providerID,
    env_public_id: normalizedEnvPublicID,
    label: compact(options.label) || normalizedEnvPublicID,
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    access: options.access ?? defaultDesktopManagedEnvironmentAccess(),
  };
}

export function managedEnvironmentSortKey(environment: DesktopManagedEnvironment): readonly [number, string, string] {
  return [
    environment.pinned ? 0 : 1,
    environment.label.toLowerCase(),
    environment.id,
  ];
}
