import { DEFAULT_DESKTOP_LOCAL_UI_BIND } from './desktopAccessModel';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';

export type DesktopManagedEnvironmentAccess = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_configured: boolean;
}>;

export type DesktopManagedEnvironmentPreferredOpenRoute = 'auto' | 'local_host' | 'remote_desktop';
export type DesktopManagedEnvironmentLocalOwner = 'desktop' | 'agent' | 'unknown';
export type DesktopManagedEnvironmentLocalScopeKind = 'local' | 'named' | 'controlplane';

export type DesktopManagedEnvironmentLocalScope = Readonly<
  | {
      kind: 'local';
      name: string;
    }
  | {
      kind: 'named';
      name: string;
    }
  | {
      kind: 'controlplane';
      provider_origin: string;
      provider_key: string;
      env_public_id: string;
    }
>;

export type DesktopManagedEnvironmentRuntimeState = Readonly<{
  local_ui_url: string;
  effective_run_mode: string;
  remote_enabled: boolean;
  desktop_managed: boolean;
  password_required: boolean;
  diagnostics_enabled: boolean;
  pid: number;
}>;

export type DesktopManagedEnvironmentLocalHosting = Readonly<{
  scope: DesktopManagedEnvironmentLocalScope;
  scope_key: string;
  state_dir: string;
  owner: DesktopManagedEnvironmentLocalOwner;
  access: DesktopManagedEnvironmentAccess;
  current_runtime?: DesktopManagedEnvironmentRuntimeState;
}>;

export type DesktopManagedEnvironmentProviderBinding = Readonly<{
  provider_origin: string;
  provider_id: string;
  env_public_id: string;
  remote_web_supported: boolean;
  remote_desktop_supported: boolean;
}>;

export type DesktopManagedEnvironmentIdentity =
  | Readonly<{
      kind: 'provisional_local';
      local_name: string;
    }>
  | Readonly<{
      kind: 'provider';
      provider_origin: string;
      provider_id: string;
      env_public_id: string;
    }>;

export type DesktopManagedEnvironment = Readonly<{
  id: string;
  label: string;
  pinned: boolean;
  created_at_ms: number;
  updated_at_ms: number;
  last_used_at_ms: number;
  preferred_open_route: DesktopManagedEnvironmentPreferredOpenRoute;
  identity: DesktopManagedEnvironmentIdentity;
  local_hosting?: DesktopManagedEnvironmentLocalHosting;
  provider_binding?: DesktopManagedEnvironmentProviderBinding;
}>;

export type DesktopManagedLocalEnvironment = DesktopManagedEnvironment;
export type DesktopManagedControlPlaneEnvironment = DesktopManagedEnvironment;

export const DEFAULT_LOCAL_ENVIRONMENT_NAME = 'default';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function sanitizeIDFragment(value: string): string {
  return compact(value).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

function titleizeSegments(value: string, fallback: string): string {
  return value.split(/[-_.]+/).filter(Boolean).map((segment) => (
    segment.slice(0, 1).toUpperCase() + segment.slice(1)
  )).join(' ') || fallback;
}

export function normalizeDesktopLocalEnvironmentName(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value).toLowerCase());
  return normalized || DEFAULT_LOCAL_ENVIRONMENT_NAME;
}

export function normalizeDesktopNamedEnvironmentName(value: unknown): string {
  const normalized = sanitizeIDFragment(compact(value).toLowerCase());
  if (normalized === '') {
    throw new Error('Named scope is required.');
  }
  return normalized;
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

export function desktopManagedLocalEnvironmentID(name: string): string {
  return `local:${encodeURIComponent(normalizeDesktopLocalEnvironmentName(name))}`;
}

export function desktopManagedNamedEnvironmentID(name: string): string {
  return `named:${encodeURIComponent(normalizeDesktopNamedEnvironmentName(name))}`;
}

export function desktopManagedControlPlaneEnvironmentID(providerOrigin: string, envPublicID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedEnvPublicID = normalizeDesktopProviderEnvironmentID(envPublicID);
  return `cp:${encodeURIComponent(normalizedOrigin)}:env:${encodeURIComponent(normalizedEnvPublicID)}`;
}

export function desktopManagedEnvironmentIDForScope(scope: DesktopManagedEnvironmentLocalScope): string {
  if (scope.kind === 'local') {
    return desktopManagedLocalEnvironmentID(scope.name);
  }
  if (scope.kind === 'named') {
    return desktopManagedNamedEnvironmentID(scope.name);
  }
  return desktopManagedControlPlaneEnvironmentID(scope.provider_origin, scope.env_public_id);
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
    return 'Local Default Environment';
  }
  return titleizeSegments(normalizedName, 'Local Environment');
}

export function defaultNamedManagedEnvironmentLabel(name: string): string {
  return titleizeSegments(normalizeDesktopNamedEnvironmentName(name), 'Named Environment');
}

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
  };
}

type CreateManagedEnvironmentLocalHostingOptions = Readonly<{
  access?: DesktopManagedEnvironmentAccess;
  owner?: DesktopManagedEnvironmentLocalOwner;
  stateDir?: string;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
}>;

export function createManagedEnvironmentLocalHosting(
  scope: DesktopManagedEnvironmentLocalScope,
  options: CreateManagedEnvironmentLocalHostingOptions = {},
): DesktopManagedEnvironmentLocalHosting {
  const normalizedScope = (() => {
    if (scope.kind === 'local') {
      const name = normalizeDesktopLocalEnvironmentName(scope.name);
      return {
        scope: {
          kind: 'local',
          name,
        } as const,
        scope_key: `local/${name}`,
      };
    }
    if (scope.kind === 'named') {
      const name = normalizeDesktopNamedEnvironmentName(scope.name);
      return {
        scope: {
          kind: 'named',
          name,
        } as const,
        scope_key: `named/${name}`,
      };
    }
    const providerOrigin = normalizeControlPlaneOrigin(scope.provider_origin);
    const providerKey = normalizeDesktopProviderKey(scope.provider_key);
    const envPublicID = normalizeDesktopProviderEnvironmentID(scope.env_public_id);
    return {
      scope: {
        kind: 'controlplane',
        provider_origin: providerOrigin,
        provider_key: providerKey,
        env_public_id: envPublicID,
      } as const,
      scope_key: `controlplane/${providerKey}/${envPublicID}`,
    };
  })();

  return {
    scope: normalizedScope.scope,
    scope_key: normalizedScope.scope_key,
    state_dir: compact(options.stateDir),
    owner: options.owner ?? 'desktop',
    access: options.access ?? defaultDesktopManagedEnvironmentAccess(),
    current_runtime: normalizeRuntimeState(options.currentRuntime),
  };
}

type CreateManagedEnvironmentProviderBindingOptions = Readonly<{
  providerID: string;
  remoteWebSupported?: boolean;
  remoteDesktopSupported?: boolean;
}>;

export function createManagedEnvironmentProviderBinding(
  providerOrigin: string,
  envPublicID: string,
  options: CreateManagedEnvironmentProviderBindingOptions,
): DesktopManagedEnvironmentProviderBinding {
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

function normalizeManagedEnvironmentIdentity(
  value: DesktopManagedEnvironmentIdentity | undefined,
  localHosting: DesktopManagedEnvironmentLocalHosting | undefined,
  providerBinding: DesktopManagedEnvironmentProviderBinding | undefined,
): DesktopManagedEnvironmentIdentity {
  if (providerBinding) {
    return {
      kind: 'provider',
      provider_origin: providerBinding.provider_origin,
      provider_id: providerBinding.provider_id,
      env_public_id: providerBinding.env_public_id,
    };
  }
  if (value?.kind === 'provider') {
    return {
      kind: 'provider',
      provider_origin: normalizeControlPlaneOrigin(value.provider_origin),
      provider_id: compact(value.provider_id),
      env_public_id: normalizeDesktopProviderEnvironmentID(value.env_public_id),
    };
  }
  const localName = localHosting?.scope.kind === 'controlplane'
    ? localHosting.scope.env_public_id
    : localHosting?.scope.name;
  return {
    kind: 'provisional_local',
    local_name: normalizeDesktopLocalEnvironmentName(value?.kind === 'provisional_local' ? value.local_name : localName),
  };
}

type CreateManagedEnvironmentOptions = Readonly<{
  environmentID?: string;
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  identity?: DesktopManagedEnvironmentIdentity;
  localHosting?: DesktopManagedEnvironmentLocalHosting;
  providerBinding?: DesktopManagedEnvironmentProviderBinding;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createManagedEnvironment(options: CreateManagedEnvironmentOptions): DesktopManagedEnvironment {
  const localHosting = options.localHosting;
  const providerBinding = options.providerBinding;
  if (!localHosting && !providerBinding) {
    throw new Error('Environment requires local hosting or a provider binding.');
  }

  const identity = normalizeManagedEnvironmentIdentity(options.identity, localHosting, providerBinding);
  const environmentID = compact(options.environmentID)
    || (
      localHosting
        ? desktopManagedEnvironmentIDForScope(localHosting.scope)
        : desktopManagedControlPlaneEnvironmentID(providerBinding!.provider_origin, providerBinding!.env_public_id)
    );
  const now = Math.max(
    Number(options.createdAtMS ?? Number.NaN) || 0,
    Number(options.updatedAtMS ?? Number.NaN) || 0,
    Number(options.lastUsedAtMS ?? Number.NaN) || 0,
    Date.now(),
  );

  const fallbackLabel = providerBinding
    ? compact(providerBinding.env_public_id)
    : localHosting?.scope.kind === 'named'
      ? defaultNamedManagedEnvironmentLabel(localHosting.scope.name)
      : defaultLocalManagedEnvironmentLabel(localHosting?.scope.kind === 'local' ? localHosting.scope.name : DEFAULT_LOCAL_ENVIRONMENT_NAME);

  return {
    id: environmentID,
    label: compact(options.label) || fallbackLabel,
    pinned: options.pinned === true,
    created_at_ms: Number(options.createdAtMS ?? now) || now,
    updated_at_ms: Number(options.updatedAtMS ?? now) || now,
    last_used_at_ms: Number(options.lastUsedAtMS ?? 0) || 0,
    preferred_open_route: options.preferredOpenRoute ?? 'auto',
    identity,
    ...(localHosting ? { local_hosting: localHosting } : {}),
    ...(providerBinding ? { provider_binding: providerBinding } : {}),
  };
}

type CreateManagedLocalEnvironmentOptions = Readonly<{
  environmentID?: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  providerBinding?: DesktopManagedEnvironmentProviderBinding;
  owner?: DesktopManagedEnvironmentLocalOwner;
  stateDir?: string;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createManagedLocalEnvironment(
  name: string,
  options: CreateManagedLocalEnvironmentOptions = {},
): DesktopManagedEnvironment {
  const normalizedName = normalizeDesktopLocalEnvironmentName(name);
  const localHosting = createManagedEnvironmentLocalHosting(
    { kind: 'local', name: normalizedName },
    {
      access: options.access,
      owner: options.owner,
      stateDir: options.stateDir,
      currentRuntime: options.currentRuntime,
    },
  );
  return createManagedEnvironment({
    environmentID: options.environmentID,
    label: options.label || defaultLocalManagedEnvironmentLabel(normalizedName),
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    identity: options.providerBinding
      ? undefined
      : {
          kind: 'provisional_local',
          local_name: normalizedName,
        },
    localHosting,
    providerBinding: options.providerBinding,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
}

type CreateManagedNamedEnvironmentOptions = Readonly<{
  environmentID?: string;
  label?: string;
  pinned?: boolean;
  access?: DesktopManagedEnvironmentAccess;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  providerBinding?: DesktopManagedEnvironmentProviderBinding;
  owner?: DesktopManagedEnvironmentLocalOwner;
  stateDir?: string;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function createManagedNamedEnvironment(
  name: string,
  options: CreateManagedNamedEnvironmentOptions = {},
): DesktopManagedEnvironment {
  const normalizedName = normalizeDesktopNamedEnvironmentName(name);
  const localHosting = createManagedEnvironmentLocalHosting(
    { kind: 'named', name: normalizedName },
    {
      access: options.access,
      owner: options.owner,
      stateDir: options.stateDir,
      currentRuntime: options.currentRuntime,
    },
  );
  return createManagedEnvironment({
    environmentID: options.environmentID,
    label: options.label || defaultNamedManagedEnvironmentLabel(normalizedName),
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    identity: options.providerBinding
      ? undefined
      : {
          kind: 'provisional_local',
          local_name: normalizedName,
        },
    localHosting,
    providerBinding: options.providerBinding,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
}

type CreateManagedControlPlaneEnvironmentOptions = Readonly<{
  providerID: string;
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  localHosting?: DesktopManagedEnvironmentLocalHosting;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
  remoteWebSupported?: boolean;
  remoteDesktopSupported?: boolean;
}>;

export function createManagedControlPlaneEnvironment(
  providerOrigin: string,
  envPublicID: string,
  options: CreateManagedControlPlaneEnvironmentOptions,
): DesktopManagedEnvironment {
  const providerBinding = createManagedEnvironmentProviderBinding(providerOrigin, envPublicID, {
    providerID: options.providerID,
    remoteWebSupported: options.remoteWebSupported,
    remoteDesktopSupported: options.remoteDesktopSupported,
  });
  return createManagedEnvironment({
    environmentID: options.localHosting ? undefined : desktopManagedControlPlaneEnvironmentID(providerOrigin, envPublicID),
    label: compact(options.label) || providerBinding.env_public_id,
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    localHosting: options.localHosting,
    providerBinding,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
}

export function managedEnvironmentSupportsLocalHosting(environment: DesktopManagedEnvironment): boolean {
  return Boolean(environment.local_hosting);
}

export function managedEnvironmentSupportsRemoteDesktop(environment: DesktopManagedEnvironment): boolean {
  return environment.provider_binding?.remote_desktop_supported === true;
}

export function managedEnvironmentSupportsRemoteWeb(environment: DesktopManagedEnvironment): boolean {
  return environment.provider_binding?.remote_web_supported === true;
}

export function managedEnvironmentKind(environment: DesktopManagedEnvironment): 'local' | 'controlplane' {
  return environment.provider_binding ? 'controlplane' : 'local';
}

export function isDefaultLocalManagedEnvironment(environment: DesktopManagedEnvironment | null | undefined): boolean {
  const scope = environment?.local_hosting?.scope;
  return scope?.kind === 'local' && scope.name === DEFAULT_LOCAL_ENVIRONMENT_NAME;
}

export function managedEnvironmentLocalName(environment: DesktopManagedEnvironment): string | undefined {
  const scope = environment.local_hosting?.scope;
  if (!scope || scope.kind === 'controlplane') {
    return undefined;
  }
  return scope.name;
}

export function managedEnvironmentLocalAccess(environment: DesktopManagedEnvironment): DesktopManagedEnvironmentAccess {
  return environment.local_hosting?.access ?? defaultDesktopManagedEnvironmentAccess();
}

export function managedEnvironmentScopeKey(environment: DesktopManagedEnvironment): string {
  return environment.local_hosting?.scope_key ?? '';
}

export function managedEnvironmentStateDir(environment: DesktopManagedEnvironment): string {
  return environment.local_hosting?.state_dir ?? '';
}

export function managedEnvironmentProviderOrigin(environment: DesktopManagedEnvironment): string {
  return environment.provider_binding?.provider_origin ?? '';
}

export function managedEnvironmentProviderID(environment: DesktopManagedEnvironment): string {
  return environment.provider_binding?.provider_id ?? '';
}

export function managedEnvironmentPublicID(environment: DesktopManagedEnvironment): string {
  return environment.provider_binding?.env_public_id ?? '';
}

export function managedEnvironmentDefaultOpenRoute(
  environment: DesktopManagedEnvironment,
): DesktopManagedEnvironmentPreferredOpenRoute {
  if (
    environment.preferred_open_route === 'local_host'
    && managedEnvironmentSupportsLocalHosting(environment)
  ) {
    return 'local_host';
  }
  if (
    environment.preferred_open_route === 'remote_desktop'
    && managedEnvironmentSupportsRemoteDesktop(environment)
  ) {
    return 'remote_desktop';
  }
  if (managedEnvironmentSupportsLocalHosting(environment)) {
    return 'local_host';
  }
  if (managedEnvironmentSupportsRemoteDesktop(environment)) {
    return 'remote_desktop';
  }
  return 'auto';
}

export function managedEnvironmentSortKey(environment: DesktopManagedEnvironment): readonly [number, string, string] {
  return [
    environment.pinned ? 0 : 1,
    environment.label.toLowerCase(),
    environment.id,
  ];
}
