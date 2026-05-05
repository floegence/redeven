import { DEFAULT_DESKTOP_LOCAL_UI_BIND } from './desktopAccessModel';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import type { DesktopProviderEnvironmentRecord } from './desktopProviderEnvironment';
import { normalizeRuntimeServiceSnapshot, type RuntimeServiceSnapshot } from './runtimeService';

export type DesktopLocalEnvironmentAccess = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_configured: boolean;
}>;

export type DesktopLocalEnvironmentPreferredOpenRoute = 'auto' | 'local_host' | 'remote_desktop';
export type DesktopLocalEnvironmentOwner = 'desktop' | 'agent' | 'unknown';
export type DesktopLocalEnvironmentScopeKind = 'local_environment';

export type DesktopLocalEnvironmentScope = Readonly<{
  kind: DesktopLocalEnvironmentScopeKind;
  name: string;
}>;

export type DesktopLocalEnvironmentRuntimeState = Readonly<{
  local_ui_url: string;
  effective_run_mode: string;
  remote_enabled: boolean;
  desktop_managed: boolean;
  controlplane_base_url?: string;
  controlplane_provider_id?: string;
  env_public_id?: string;
  password_required: boolean;
  diagnostics_enabled: boolean;
  pid: number;
  runtime_service?: RuntimeServiceSnapshot;
}>;

export type DesktopLocalEnvironmentHosting = Readonly<{
  scope: DesktopLocalEnvironmentScope;
  scope_key: 'local_environment';
  state_dir: string;
  owner: DesktopLocalEnvironmentOwner;
  access: DesktopLocalEnvironmentAccess;
  current_runtime?: DesktopLocalEnvironmentRuntimeState;
}>;

export type DesktopLocalEnvironmentProviderBinding = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  remote_web_supported: boolean;
  remote_desktop_supported: boolean;
}>;

export type DesktopLocalEnvironmentState = Readonly<{
  id: typeof LOCAL_ENVIRONMENT_ID;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  preferred_open_route: DesktopLocalEnvironmentPreferredOpenRoute;
  local_hosting: DesktopLocalEnvironmentHosting;
  current_provider_binding?: DesktopLocalEnvironmentProviderBinding;
}>;

export const LOCAL_ENVIRONMENT_ID = 'local';
export const DEFAULT_LOCAL_ENVIRONMENT_NAME = 'local';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeIDFragment(value: string): string {
  return compact(value)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

export function normalizeDesktopLocalEnvironmentName(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value).toLowerCase());
  return normalized || DEFAULT_LOCAL_ENVIRONMENT_NAME;
}

export function normalizeDesktopProviderEnvironmentID(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value));
  if (normalized === '') {
    throw new Error('Environment ID is required.');
  }
  return normalized;
}

export function normalizeDesktopProviderKey(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value).toLowerCase());
  if (normalized === '') {
    throw new Error('Provider key is required.');
  }
  return normalized;
}

export function desktopLocalEnvironmentStateID(_name: string): typeof LOCAL_ENVIRONMENT_ID {
  return LOCAL_ENVIRONMENT_ID;
}

export function desktopProviderEnvironmentStateID(providerOrigin: string, envPublicID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  return `cp:${encodeURIComponent(normalizedOrigin)}:env:${encodeURIComponent(normalizedEnvPublicID)}`;
}

export function desktopLocalEnvironmentStateIDForScope(_scope: DesktopLocalEnvironmentScope): typeof LOCAL_ENVIRONMENT_ID {
  return LOCAL_ENVIRONMENT_ID;
}

export function defaultDesktopLocalEnvironmentAccess(): DesktopLocalEnvironmentAccess {
  return {
    local_ui_bind: DEFAULT_DESKTOP_LOCAL_UI_BIND,
    local_ui_password: '',
    local_ui_password_configured: false,
  };
}

export function defaultDesktopLocalEnvironmentLabel(_name: string): string {
  return 'Local Environment';
}

function normalizeRuntimeState(
  value: Partial<DesktopLocalEnvironmentRuntimeState> | null | undefined,
): DesktopLocalEnvironmentRuntimeState | undefined {
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
    controlplane_base_url: compact(value.controlplane_base_url) || undefined,
    controlplane_provider_id: compact(value.controlplane_provider_id) || undefined,
    env_public_id: compact(value.env_public_id) || undefined,
    password_required: value.password_required === true,
    diagnostics_enabled: value.diagnostics_enabled === true,
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    runtime_service: normalizeRuntimeServiceSnapshot(value.runtime_service ?? {}, {
      desktopManaged: value.desktop_managed === true,
      effectiveRunMode: value.effective_run_mode,
      remoteEnabled: value.remote_enabled === true,
    }),
  };
}

type CreateDesktopLocalEnvironmentHostingOptions = Readonly<{
  access?: DesktopLocalEnvironmentAccess;
  owner?: DesktopLocalEnvironmentOwner;
  stateDir?: string;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
}>;

export function createDesktopLocalEnvironmentHosting(
  _scope: DesktopLocalEnvironmentScope,
  options: CreateDesktopLocalEnvironmentHostingOptions = {},
): DesktopLocalEnvironmentHosting {
  return {
    scope: {
      kind: 'local_environment',
      name: DEFAULT_LOCAL_ENVIRONMENT_NAME,
    },
    scope_key: 'local_environment',
    state_dir: compact(options.stateDir),
    owner: options.owner ?? 'desktop',
    access: options.access ?? defaultDesktopLocalEnvironmentAccess(),
    current_runtime: normalizeRuntimeState(options.currentRuntime),
  };
}

type CreateDesktopLocalProviderBindingOptions = Readonly<{
  providerID: string;
  remoteWebSupported?: boolean;
  remoteDesktopSupported?: boolean;
}>;

export function createDesktopLocalProviderBinding(
  providerOrigin: string,
  envPublicID: string,
  options: CreateDesktopLocalProviderBindingOptions,
): DesktopLocalEnvironmentProviderBinding {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  const providerID = compact(options.providerID);
  if (providerID === '') {
    throw new Error('Provider ID is required.');
  }
  return {
    provider_origin: normalizedOrigin,
    provider_id: providerID,
    env_public_id: normalizedEnvPublicID,
    remote_web_supported: options.remoteWebSupported !== false,
    remote_desktop_supported: options.remoteDesktopSupported !== false,
  };
}

type CreateDesktopLocalEnvironmentStateOptions = Readonly<{
  label?: string;
  pinned?: boolean;
  access?: DesktopLocalEnvironmentAccess;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  currentProviderBinding?: DesktopLocalEnvironmentProviderBinding;
  owner?: DesktopLocalEnvironmentOwner;
  stateDir?: string;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createDesktopLocalEnvironmentState(
  name: string,
  options: CreateDesktopLocalEnvironmentStateOptions = {},
): DesktopLocalEnvironmentState {
  const normalizedName = normalizeDesktopLocalEnvironmentName(name);
  const now = Math.max(
    Number(options.createdAtMS ?? Number.NaN) || 0,
    Number(options.updatedAtMS ?? Number.NaN) || 0,
    Number(options.lastUsedAtMS ?? Number.NaN) || 0,
    Date.now(),
  );
  return {
    id: LOCAL_ENVIRONMENT_ID,
    label: compact(options.label) || defaultDesktopLocalEnvironmentLabel(normalizedName),
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    preferred_open_route: options.preferredOpenRoute ?? 'auto',
    local_hosting: createDesktopLocalEnvironmentHosting(
      { kind: 'local_environment', name: DEFAULT_LOCAL_ENVIRONMENT_NAME },
      {
        access: options.access,
        owner: options.owner,
        stateDir: options.stateDir,
        currentRuntime: options.currentRuntime,
      },
    ),
    ...(options.currentProviderBinding ? { current_provider_binding: options.currentProviderBinding } : {}),
  };
}

export function projectProviderEnvironmentToLocalRuntimeTarget(
  providerEnvironment: DesktopProviderEnvironmentRecord,
  localEnvironment: DesktopLocalEnvironmentState,
): DesktopLocalEnvironmentState {
  const currentProviderBinding = createDesktopLocalProviderBinding(
    providerEnvironment.provider_origin,
    providerEnvironment.env_public_id,
    {
      providerID: providerEnvironment.provider_id,
      remoteWebSupported: providerEnvironment.remote_web_supported,
      remoteDesktopSupported: providerEnvironment.remote_desktop_supported,
    },
  );
  return createDesktopLocalEnvironmentState(DEFAULT_LOCAL_ENVIRONMENT_NAME, {
    label: providerEnvironment.label,
    pinned: localEnvironment.pinned,
    preferredOpenRoute: providerEnvironment.preferred_open_route,
    currentProviderBinding,
    access: localEnvironment.local_hosting.access,
    owner: localEnvironment.local_hosting.owner,
    stateDir: localEnvironment.local_hosting.state_dir,
    currentRuntime: localEnvironment.local_hosting.current_runtime,
    createdAtMS: localEnvironment.created_at_ms,
    updatedAtMS: Math.max(localEnvironment.updated_at_ms, providerEnvironment.updated_at_ms),
    lastUsedAtMS: Math.max(localEnvironment.last_used_at_ms, providerEnvironment.last_used_at_ms),
  });
}

export function localEnvironmentSupportsLocalHosting(_environment: DesktopLocalEnvironmentState): boolean {
  return true;
}

export function localEnvironmentSupportsRemoteDesktop(environment: DesktopLocalEnvironmentState): boolean {
  return environment.current_provider_binding?.remote_desktop_supported === true;
}

export function localEnvironmentSupportsRemoteWeb(environment: DesktopLocalEnvironmentState): boolean {
  return environment.current_provider_binding?.remote_web_supported === true;
}

export function localEnvironmentStateKind(environment: DesktopLocalEnvironmentState): 'local' | 'controlplane' {
  return environment.current_provider_binding ? 'controlplane' : 'local';
}

export function isDefaultDesktopLocalEnvironmentState(environment: DesktopLocalEnvironmentState | null | undefined): boolean {
  return environment?.id === LOCAL_ENVIRONMENT_ID
    && environment.local_hosting.scope.kind === 'local_environment'
    && environment.local_hosting.scope.name === DEFAULT_LOCAL_ENVIRONMENT_NAME;
}

export function localEnvironmentName(environment: DesktopLocalEnvironmentState): string {
  return environment.local_hosting.scope.name;
}

export function localEnvironmentAccess(environment: DesktopLocalEnvironmentState): DesktopLocalEnvironmentAccess {
  return environment.local_hosting.access;
}

export function localEnvironmentScopeKey(environment: DesktopLocalEnvironmentState): string {
  return environment.local_hosting.scope_key;
}

export function localEnvironmentStateDir(environment: DesktopLocalEnvironmentState): string {
  return environment.local_hosting.state_dir;
}

export function localEnvironmentProviderOrigin(environment: DesktopLocalEnvironmentState): string {
  return environment.current_provider_binding?.provider_origin ?? '';
}

export function localEnvironmentProviderID(environment: DesktopLocalEnvironmentState): string {
  return environment.current_provider_binding?.provider_id ?? '';
}

export function localEnvironmentPublicID(environment: DesktopLocalEnvironmentState): string {
  return environment.current_provider_binding?.env_public_id ?? '';
}

export function localEnvironmentDefaultOpenRoute(
  environment: DesktopLocalEnvironmentState,
): DesktopLocalEnvironmentPreferredOpenRoute {
  if (environment.preferred_open_route === 'remote_desktop' && localEnvironmentSupportsRemoteDesktop(environment)) {
    return 'remote_desktop';
  }
  return 'local_host';
}

export function localEnvironmentSortKey(environment: DesktopLocalEnvironmentState): readonly [number, string, string] {
  return [
    environment.pinned ? 0 : 1,
    environment.label.toLowerCase(),
    environment.id,
  ];
}
