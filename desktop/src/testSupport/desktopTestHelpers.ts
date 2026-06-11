import type {
  DesktopPreferences,
  DesktopSavedEnvironment,
  DesktopSavedRuntimeTarget,
  DesktopSavedSSHEnvironment,
} from '../main/desktopPreferences';
import { defaultDesktopPreferences } from '../main/desktopPreferences';
import { localEnvironmentStateLayout } from '../main/statePaths';
import {
  buildLocalEnvironmentDesktopTarget,
  type DesktopSessionLifecycle,
  type DesktopSessionSummary,
} from '../main/desktopTarget';
import type {
  DesktopSessionRuntimeLaunchMode,
  DesktopSessionRuntimeLifecycleOwner,
} from '../main/sessionRuntime';
import type { StartupReport } from '../main/startup';
import {
  projectProviderEnvironmentToLocalRuntimeTarget,
  createDesktopLocalEnvironmentState,
  defaultDesktopLocalEnvironmentAccess,
  type DesktopLocalEnvironmentAccess,
  type DesktopLocalEnvironmentOwner,
  type DesktopLocalEnvironmentPreferredOpenRoute,
  type DesktopLocalEnvironmentRuntimeState,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopProviderEnvironmentRecord,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';

type TestLocalAccessOverrides = Partial<DesktopLocalEnvironmentAccess>;

type TestLocalEnvironmentOptions = Readonly<{
  label?: string;
  access?: TestLocalAccessOverrides;
  pinned?: boolean;
  autoRuntimeProbeEnabled?: boolean;
  stateDir?: string;
  owner?: DesktopLocalEnvironmentOwner;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestProviderBoundLocalEnvironmentOptions = Readonly<{
  providerID?: string;
  region?: string;
  accessPointID?: string;
  accessPointOrigin?: string;
  label?: string;
  access?: TestLocalAccessOverrides;
  pinned?: boolean;
  autoRuntimeProbeEnabled?: boolean;
  stateDir?: string;
  owner?: DesktopLocalEnvironmentOwner;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  localHosting?: boolean;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestSavedEnvironmentInput =
  | DesktopSavedEnvironment
  | Omit<DesktopSavedEnvironment, 'auto_runtime_probe_enabled'> & Partial<Pick<DesktopSavedEnvironment, 'auto_runtime_probe_enabled'>>;
type TestSavedSSHEnvironmentInput =
  | DesktopSavedSSHEnvironment
  | Omit<DesktopSavedSSHEnvironment, 'auto_runtime_probe_enabled'> & Partial<Pick<DesktopSavedSSHEnvironment, 'auto_runtime_probe_enabled'>>;
type TestSavedRuntimeTargetInput =
  | DesktopSavedRuntimeTarget
  | Omit<DesktopSavedRuntimeTarget, 'auto_runtime_probe_enabled'> & Partial<Pick<DesktopSavedRuntimeTarget, 'auto_runtime_probe_enabled'>>;

type TestDesktopPreferencesOptions = Readonly<Omit<Partial<DesktopPreferences>, 'saved_environments' | 'saved_ssh_environments' | 'saved_runtime_targets'> & {
  local_environment?: DesktopLocalEnvironmentState;
  saved_environments?: readonly TestSavedEnvironmentInput[];
  saved_ssh_environments?: readonly TestSavedSSHEnvironmentInput[];
  saved_runtime_targets?: readonly TestSavedRuntimeTargetInput[];
}>;

type TestProviderEnvironmentOptions = Readonly<{
  providerID?: string;
  region?: string;
  accessPointID?: string;
  accessPointOrigin?: string;
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

function testCurrentRuntime(
  runtime: Partial<DesktopLocalEnvironmentRuntimeState> | null | undefined,
): Partial<DesktopLocalEnvironmentRuntimeState> | null | undefined {
  if (!runtime || runtime.desktop_managed !== true || runtime.desktop_ownership) {
    return runtime;
  }
  return {
    ...runtime,
    desktop_owner_id: runtime.desktop_owner_id ?? 'desktop-owner-test',
    desktop_ownership: 'owned',
  };
}

function defaultTestAccessPointOrigin(providerOrigin: string): string {
  try {
    const parsed = new URL(providerOrigin);
    if (parsed.hostname === 'redeven.test') {
      return 'https://dev.redeven.test';
    }
    if (/^[a-z]+\.redeven\.(test|com)$/u.test(parsed.hostname)) {
      return parsed.origin;
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return parsed.origin;
    }
    parsed.hostname = `dev.${parsed.hostname}`;
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return 'https://dev.redeven.test';
  }
}

function normalizeTestSavedEnvironment(environment: TestSavedEnvironmentInput): DesktopSavedEnvironment {
  return {
    ...environment,
    auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
  };
}

function normalizeTestSavedSSHEnvironment(environment: TestSavedSSHEnvironmentInput): DesktopSavedSSHEnvironment {
  return {
    ...environment,
    auto_runtime_probe_enabled: environment.auto_runtime_probe_enabled === true,
  };
}

function normalizeTestSavedRuntimeTarget(target: TestSavedRuntimeTargetInput): DesktopSavedRuntimeTarget {
  return {
    ...target,
    auto_runtime_probe_enabled: target.auto_runtime_probe_enabled === true,
  };
}

export function testLocalAccess(
  overrides: TestLocalAccessOverrides = {},
): DesktopLocalEnvironmentAccess {
  return {
    ...defaultDesktopLocalEnvironmentAccess(),
    ...overrides,
  };
}

export function testLocalEnvironment(
  options: TestLocalEnvironmentOptions = {},
): DesktopLocalEnvironmentState {
  return createDesktopLocalEnvironmentState({
    label: options.label,
    pinned: options.pinned,
    autoRuntimeProbeEnabled: options.autoRuntimeProbeEnabled,
    stateDir: options.stateDir ?? localEnvironmentStateLayout().stateDir,
    owner: options.owner,
    preferredOpenRoute: options.preferredOpenRoute,
    currentRuntime: testCurrentRuntime(options.currentRuntime),
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
    access: testLocalAccess(options.access),
  });
}

export function testProviderBoundLocalEnvironment(
  providerOrigin: string,
  envPublicID: string,
  options: TestProviderBoundLocalEnvironmentOptions = {},
): DesktopLocalEnvironmentState {
  const layout = localEnvironmentStateLayout();
  const providerEnvironment = testProviderEnvironment(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'example_control_plane',
    region: options.region,
    accessPointID: options.accessPointID,
    accessPointOrigin: options.accessPointOrigin,
    label: options.label,
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
  return projectProviderEnvironmentToLocalRuntimeTarget(
    providerEnvironment,
    testLocalEnvironment({
      access: options.access,
      autoRuntimeProbeEnabled: options.autoRuntimeProbeEnabled,
      owner: options.owner ?? 'desktop',
      stateDir: options.stateDir ?? layout.stateDir,
      currentRuntime: testCurrentRuntime(options.currentRuntime),
      createdAtMS: options.createdAtMS,
      updatedAtMS: options.updatedAtMS,
      lastUsedAtMS: options.lastUsedAtMS,
    }),
  );
}

export function testProviderEnvironment(
  providerOrigin: string,
  envPublicID: string,
  options: TestProviderEnvironmentOptions = {},
): DesktopProviderEnvironmentRecord {
  const region = options.region ?? 'dev';
  const accessPointID = options.accessPointID ?? region;
  return createDesktopProviderEnvironmentRecord(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'example_control_plane',
    region,
    accessPointID,
    accessPointOrigin: options.accessPointOrigin ?? defaultTestAccessPointOrigin(providerOrigin),
    label: options.label,
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
}

export function testDesktopPreferences(
  options: TestDesktopPreferencesOptions = {},
): DesktopPreferences {
  const base = defaultDesktopPreferences();
  const localEnvironment = options.local_environment ?? base.local_environment;
  const {
    local_environment: _localEnvironment,
    ...preferenceOverrides
  } = options;
  const hasExplicitProviderEnvironments = Object.hasOwn(options, 'provider_environments');
  const providerEnvironmentsByID = new Map(
    (options.provider_environments ?? base.provider_environments).map((environment) => [environment.id, environment] as const),
  );

  const localProviderBinding = localEnvironment.current_provider_binding;
  if (localProviderBinding && !hasExplicitProviderEnvironments) {
    const providerEnvironment = testProviderEnvironment(
      localProviderBinding.provider_origin,
      localProviderBinding.env_public_id,
      {
        providerID: localProviderBinding.provider_id,
        accessPointOrigin: localProviderBinding.access_point_origin,
      },
    );
    if (!providerEnvironmentsByID.has(providerEnvironment.id)) {
      providerEnvironmentsByID.set(providerEnvironment.id, providerEnvironment);
    }
  }

  return {
    ...base,
    ...preferenceOverrides,
    local_environment: localEnvironment,
    provider_environments: [...providerEnvironmentsByID.values()],
    saved_environments: (options.saved_environments ?? base.saved_environments).map(normalizeTestSavedEnvironment),
    saved_ssh_environments: (options.saved_ssh_environments ?? base.saved_ssh_environments).map(normalizeTestSavedSSHEnvironment),
    saved_runtime_targets: (options.saved_runtime_targets ?? base.saved_runtime_targets).map(normalizeTestSavedRuntimeTarget),
  };
}

export function testLocalEnvironmentSession(
  environment: DesktopLocalEnvironmentState,
  localUIURL: string,
  lifecycle: DesktopSessionLifecycle = 'open',
  startupOverrides: Partial<StartupReport> = {},
  options: Readonly<{
    runtimeLifecycleOwner?: DesktopSessionRuntimeLifecycleOwner;
    runtimeLaunchMode?: DesktopSessionRuntimeLaunchMode;
  }> = {},
): DesktopSessionSummary {
  const target = buildLocalEnvironmentDesktopTarget(environment);
  const desktopManaged = startupOverrides.desktop_managed !== false;
  const effectiveRunMode = String(startupOverrides.effective_run_mode ?? 'desktop');
  const remoteEnabled = startupOverrides.remote_enabled === true;
  const serviceOwner = options.runtimeLifecycleOwner === 'external'
    ? 'external'
    : desktopManaged
      ? 'desktop'
      : 'unknown';
  const currentProviderBinding = environment.current_provider_binding;
  return {
    session_key: target.session_key,
    target,
    lifecycle,
    entry_url: localUIURL,
    startup: {
      local_ui_url: localUIURL,
      local_ui_urls: [localUIURL],
      ...(currentProviderBinding ? {
        provider_origin: currentProviderBinding.provider_origin,
        controlplane_base_url: currentProviderBinding.access_point_origin,
        controlplane_provider_id: currentProviderBinding.provider_id,
        env_public_id: currentProviderBinding.env_public_id,
      } : {}),
      runtime_service: {
        protocol_version: 'redeven-runtime-v1',
        service_owner: serviceOwner,
        desktop_managed: desktopManaged,
        effective_run_mode: effectiveRunMode,
        remote_enabled: remoteEnabled,
        compatibility: 'compatible',
        open_readiness: { state: 'openable' },
        active_workload: {
          terminal_count: 0,
          session_count: 0,
          task_count: 0,
          port_forward_count: 0,
        },
      },
      ...startupOverrides,
    },
    runtime_lifecycle_owner: options.runtimeLifecycleOwner,
    runtime_launch_mode: options.runtimeLaunchMode,
  };
}
