import type { DesktopPreferences } from '../main/desktopPreferences';
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
  label?: string;
  access?: TestLocalAccessOverrides;
  pinned?: boolean;
  stateDir?: string;
  owner?: DesktopLocalEnvironmentOwner;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  localHosting?: boolean;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestDesktopPreferencesOptions = Readonly<Partial<DesktopPreferences> & {
  local_environment?: DesktopLocalEnvironmentState;
}>;

type TestProviderEnvironmentOptions = Readonly<{
  providerID?: string;
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
  return createDesktopProviderEnvironmentRecord(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'example_control_plane',
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
  const providerEnvironmentsByID = new Map(
    (options.provider_environments ?? base.provider_environments).map((environment) => [environment.id, environment] as const),
  );

  const localProviderBinding = localEnvironment.current_provider_binding;
  if (localProviderBinding) {
    const providerEnvironment = testProviderEnvironment(
      localProviderBinding.provider_origin,
      localProviderBinding.env_public_id,
      {
        providerID: localProviderBinding.provider_id,
      },
    );
    if (!providerEnvironmentsByID.has(providerEnvironment.id)) {
      providerEnvironmentsByID.set(providerEnvironment.id, providerEnvironment);
    }
  }

  for (const controlPlane of options.control_planes ?? base.control_planes) {
    for (const environment of controlPlane.environments) {
      const providerEnvironment = testProviderEnvironment(
        controlPlane.provider.provider_origin,
        environment.env_public_id,
        {
          providerID: controlPlane.provider.provider_id,
          label: environment.label,
          createdAtMS: controlPlane.last_synced_at_ms,
          updatedAtMS: controlPlane.last_synced_at_ms,
        },
      );
      if (!providerEnvironmentsByID.has(providerEnvironment.id)) {
        providerEnvironmentsByID.set(providerEnvironment.id, providerEnvironment);
      }
    }
  }

  return {
    ...base,
    ...preferenceOverrides,
    local_environment: localEnvironment,
    provider_environments: [...providerEnvironmentsByID.values()],
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
        controlplane_base_url: currentProviderBinding.provider_origin,
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
