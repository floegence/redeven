import type { DesktopPreferences } from '../main/desktopPreferences';
import { defaultDesktopPreferences } from '../main/desktopPreferences';
import { localEnvironmentManagedStateLayout } from '../main/statePaths';
import {
  buildManagedEnvironmentDesktopTarget,
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

type TestManagedAccessOverrides = Partial<DesktopLocalEnvironmentAccess>;

type TestManagedLocalEnvironmentOptions = Readonly<{
  label?: string;
  access?: TestManagedAccessOverrides;
  pinned?: boolean;
  stateDir?: string;
  owner?: DesktopLocalEnvironmentOwner;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestManagedControlPlaneEnvironmentOptions = Readonly<{
  providerID?: string;
  label?: string;
  access?: TestManagedAccessOverrides;
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
  managed_environments?: readonly DesktopLocalEnvironmentState[];
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

export function testManagedAccess(
  overrides: TestManagedAccessOverrides = {},
): DesktopLocalEnvironmentAccess {
  return {
    ...defaultDesktopLocalEnvironmentAccess(),
    ...overrides,
  };
}

export function testManagedLocalEnvironment(
  name = 'default',
  options: TestManagedLocalEnvironmentOptions = {},
): DesktopLocalEnvironmentState {
  return createDesktopLocalEnvironmentState(name, {
    label: options.label,
    pinned: options.pinned,
    stateDir: options.stateDir ?? localEnvironmentManagedStateLayout().stateDir,
    owner: options.owner,
    preferredOpenRoute: options.preferredOpenRoute,
    currentRuntime: options.currentRuntime,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
    access: testManagedAccess(options.access),
  });
}

export function testManagedControlPlaneEnvironment(
  providerOrigin: string,
  envPublicID: string,
  options: TestManagedControlPlaneEnvironmentOptions = {},
): DesktopLocalEnvironmentState {
  const layout = localEnvironmentManagedStateLayout();
  const providerEnvironment = testProviderEnvironment(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'redeven_portal',
    label: options.label,
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
  });
  return projectProviderEnvironmentToLocalRuntimeTarget(
    providerEnvironment,
    testManagedLocalEnvironment('local', {
      access: options.access,
      owner: options.owner ?? 'desktop',
      stateDir: options.stateDir ?? layout.stateDir,
      currentRuntime: options.currentRuntime,
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
    providerID: options.providerID ?? 'redeven_portal',
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
  const managedEnvironmentOptions = options.managed_environments ?? [];
  const localEnvironment = options.local_environment
    ?? managedEnvironmentOptions.find((environment) => !environment.current_provider_binding)
    ?? managedEnvironmentOptions[0]
    ?? base.local_environment;
  const {
    managed_environments: _legacyManagedEnvironments,
    local_environment: _localEnvironment,
    ...preferenceOverrides
  } = options;
  const providerEnvironmentsByID = new Map(
    (options.provider_environments ?? base.provider_environments).map((environment) => [environment.id, environment] as const),
  );

  for (const environment of managedEnvironmentOptions) {
    if (!environment.current_provider_binding) {
      continue;
    }
    const providerEnvironment = testProviderEnvironment(
      environment.current_provider_binding.provider_origin,
      environment.current_provider_binding.env_public_id,
      {
        providerID: environment.current_provider_binding.provider_id,
        label: environment.label,
        pinned: environment.pinned,
        preferredOpenRoute: environment.preferred_open_route,
        createdAtMS: environment.created_at_ms,
        updatedAtMS: environment.updated_at_ms,
        lastUsedAtMS: environment.last_used_at_ms,
      },
    );
    providerEnvironmentsByID.set(providerEnvironment.id, providerEnvironment);
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

export function testManagedSession(
  environment: DesktopLocalEnvironmentState,
  localUIURL: string,
  lifecycle: DesktopSessionLifecycle = 'open',
  startupOverrides: Partial<StartupReport> = {},
  options: Readonly<{
    runtimeLifecycleOwner?: DesktopSessionRuntimeLifecycleOwner;
    runtimeLaunchMode?: DesktopSessionRuntimeLaunchMode;
  }> = {},
): DesktopSessionSummary {
  const target = buildManagedEnvironmentDesktopTarget(environment);
  const desktopManaged = startupOverrides.desktop_managed !== false;
  const effectiveRunMode = String(startupOverrides.effective_run_mode ?? 'desktop');
  const remoteEnabled = startupOverrides.remote_enabled === true;
  const serviceOwner = options.runtimeLifecycleOwner === 'external'
    ? 'external'
    : desktopManaged
      ? 'desktop'
      : 'unknown';
  const providerBinding = environment.current_provider_binding;
  return {
    session_key: target.session_key,
    target,
    lifecycle,
    entry_url: localUIURL,
    startup: {
      local_ui_url: localUIURL,
      local_ui_urls: [localUIURL],
      ...(providerBinding ? {
        controlplane_base_url: providerBinding.provider_origin,
        controlplane_provider_id: providerBinding.provider_id,
        env_public_id: providerBinding.env_public_id,
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
