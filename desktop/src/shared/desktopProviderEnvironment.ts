import type { DesktopProviderEnvironment } from './controlPlaneProvider';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import {
  defaultDesktopManagedEnvironmentAccess,
  normalizeDesktopProviderEnvironmentID,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedEnvironmentLocalOwner,
  type DesktopManagedEnvironmentPreferredOpenRoute,
  type DesktopManagedEnvironmentRuntimeState,
} from './desktopManagedEnvironment';
import { normalizeRuntimeServiceSnapshot } from './runtimeService';

export type DesktopProviderEnvironmentLocalRuntimeScope = Readonly<{
  provider_origin: string;
  provider_key: string;
  env_public_id: string;
  scope_key: string;
  state_dir: string;
}>;

export type DesktopProviderEnvironmentLocalRuntime = Readonly<{
  owner: DesktopManagedEnvironmentLocalOwner;
  access: DesktopManagedEnvironmentAccess;
  scope: DesktopProviderEnvironmentLocalRuntimeScope;
  current_runtime?: DesktopManagedEnvironmentRuntimeState;
}>;

export type DesktopProviderEnvironmentRemoteCatalogEntry = Readonly<{
  environment_url: string;
  description: string;
  namespace_public_id: string;
  namespace_name: string;
  status: string;
  lifecycle_status: string;
  last_seen_at_unix_ms: number;
}>;

export type DesktopProviderEnvironmentRecord = Readonly<{
  id: string;
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  preferred_open_route: DesktopManagedEnvironmentPreferredOpenRoute;
  remote_web_supported: boolean;
  remote_desktop_supported: boolean;
  remote_catalog_entry?: DesktopProviderEnvironmentRemoteCatalogEntry;
  local_runtime?: DesktopProviderEnvironmentLocalRuntime;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeStateScopeID(value: string): string {
  return String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
}

function providerKeyForOrigin(providerOrigin: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const parsed = new URL(normalizedOrigin);
  return sanitizeStateScopeID(`${parsed.protocol.replace(/:$/u, '').toLowerCase()}__${parsed.host.toLowerCase()}`);
}

export function desktopProviderEnvironmentID(providerOrigin: string, envPublicID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  return `cp:${encodeURIComponent(normalizedOrigin)}:env:${encodeURIComponent(normalizedEnvPublicID)}`;
}

export function defaultDesktopProviderEnvironmentLabel(envPublicID: string): string {
  return normalizeDesktopProviderEnvironmentID(envPublicID);
}

type CreateDesktopProviderEnvironmentLocalRuntimeOptions = Readonly<{
  access?: DesktopManagedEnvironmentAccess;
  owner?: DesktopManagedEnvironmentLocalOwner;
  stateDir: string;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
}>;

function normalizeRuntimeState(
  value: Partial<DesktopManagedEnvironmentRuntimeState> | null | undefined,
): DesktopManagedEnvironmentRuntimeState | undefined {
  if (!value) {
    return undefined;
  }
  const localUIURL = compact(value.local_ui_url);
  if (localUIURL === '') {
    return undefined;
  }
  const pid = Number(value.pid);
  return {
    local_ui_url: localUIURL,
    effective_run_mode: compact(value.effective_run_mode),
    remote_enabled: value.remote_enabled === true,
    desktop_managed: value.desktop_managed === true,
    password_required: value.password_required === true,
    diagnostics_enabled: value.diagnostics_enabled === true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    ...(value.runtime_service ? { runtime_service: normalizeRuntimeServiceSnapshot(value.runtime_service, {
      desktopManaged: value.desktop_managed === true,
      effectiveRunMode: value.effective_run_mode,
      remoteEnabled: value.remote_enabled === true,
    }) } : {}),
  };
}

export function createDesktopProviderEnvironmentLocalRuntime(
  providerOrigin: string,
  envPublicID: string,
  options: CreateDesktopProviderEnvironmentLocalRuntimeOptions,
): DesktopProviderEnvironmentLocalRuntime {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  const providerKey = providerKeyForOrigin(normalizedOrigin);
  return {
    owner: options.owner ?? 'desktop',
    access: options.access ?? defaultDesktopManagedEnvironmentAccess(),
    scope: {
      provider_origin: normalizedOrigin,
      provider_key: providerKey,
      env_public_id: normalizedEnvPublicID,
      scope_key: `controlplane/${providerKey}/${normalizedEnvPublicID}`,
      state_dir: compact(options.stateDir),
    },
    current_runtime: normalizeRuntimeState(options.currentRuntime),
  };
}

export function desktopProviderEnvironmentRemoteCatalogEntryFromPublished(
  published: DesktopProviderEnvironment,
): DesktopProviderEnvironmentRemoteCatalogEntry {
  return {
    environment_url: compact(published.environment_url),
    description: compact(published.description),
    namespace_public_id: compact(published.namespace_public_id),
    namespace_name: compact(published.namespace_name),
    status: compact(published.status),
    lifecycle_status: compact(published.lifecycle_status),
    last_seen_at_unix_ms: Number(published.last_seen_at_unix_ms) || 0,
  };
}

type CreateDesktopProviderEnvironmentRecordOptions = Readonly<{
  environmentID?: string;
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  providerID: string;
  remoteWebSupported?: boolean;
  remoteDesktopSupported?: boolean;
  remoteCatalogEntry?: DesktopProviderEnvironmentRemoteCatalogEntry;
  localRuntime?: DesktopProviderEnvironmentLocalRuntime;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createDesktopProviderEnvironmentRecord(
  providerOrigin: string,
  envPublicID: string,
  options: CreateDesktopProviderEnvironmentRecordOptions,
): DesktopProviderEnvironmentRecord {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  const providerID = compact(options.providerID);
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
    id: compact(options.environmentID) || desktopProviderEnvironmentID(normalizedOrigin, normalizedEnvPublicID),
    provider_origin: normalizedOrigin,
    provider_id: providerID,
    env_public_id: normalizedEnvPublicID,
    label: compact(options.label) || defaultDesktopProviderEnvironmentLabel(normalizedEnvPublicID),
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    preferred_open_route: options.preferredOpenRoute ?? 'auto',
    remote_web_supported: options.remoteWebSupported !== false,
    remote_desktop_supported: options.remoteDesktopSupported !== false,
    ...(options.remoteCatalogEntry ? { remote_catalog_entry: options.remoteCatalogEntry } : {}),
    ...(options.localRuntime ? { local_runtime: options.localRuntime } : {}),
  };
}

export function providerEnvironmentLocalAccess(
  environment: DesktopProviderEnvironmentRecord,
): DesktopManagedEnvironmentAccess {
  return environment.local_runtime?.access ?? defaultDesktopManagedEnvironmentAccess();
}

export function providerEnvironmentSupportsLocalRuntime(
  environment: DesktopProviderEnvironmentRecord,
): boolean {
  return Boolean(environment.local_runtime);
}

export function providerEnvironmentSupportsRemoteDesktop(
  environment: DesktopProviderEnvironmentRecord,
): boolean {
  return environment.remote_desktop_supported === true;
}

export function providerEnvironmentSortKey(
  environment: DesktopProviderEnvironmentRecord,
): readonly [number, string, string] {
  return [
    environment.pinned ? 0 : 1,
    environment.label.toLowerCase(),
    environment.id,
  ];
}
