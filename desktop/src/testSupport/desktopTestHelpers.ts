import type { DesktopPreferences } from '../main/desktopPreferences';
import { defaultDesktopPreferences } from '../main/desktopPreferences';
import { controlPlaneManagedStateLayout, localManagedStateLayout } from '../main/statePaths';
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
  createManagedControlPlaneEnvironment,
  createManagedEnvironmentLocalHosting,
  createManagedLocalEnvironment,
  defaultDesktopManagedEnvironmentAccess,
  managedEnvironmentKind,
  type DesktopManagedControlPlaneEnvironment,
  type DesktopManagedEnvironment,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedEnvironmentLocalOwner,
  type DesktopManagedEnvironmentPreferredOpenRoute,
  type DesktopManagedEnvironmentRuntimeState,
  type DesktopManagedLocalEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  createDesktopProviderEnvironmentRecord,
  type DesktopProviderEnvironmentRecord,
} from '../shared/desktopProviderEnvironment';

type TestManagedAccessOverrides = Partial<DesktopManagedEnvironmentAccess>;

type TestManagedLocalEnvironmentOptions = Readonly<{
  label?: string;
  access?: TestManagedAccessOverrides;
  pinned?: boolean;
  stateDir?: string;
  owner?: DesktopManagedEnvironmentLocalOwner;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
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
  owner?: DesktopManagedEnvironmentLocalOwner;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  localHosting?: boolean;
  currentRuntime?: Partial<DesktopManagedEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestDesktopPreferencesOptions = Readonly<Partial<DesktopPreferences> & {
  managed_environments?: readonly DesktopManagedEnvironment[];
}>;

type TestProviderEnvironmentOptions = Readonly<{
  providerID?: string;
  label?: string;
  pinned?: boolean;
  preferredOpenRoute?: DesktopManagedEnvironmentPreferredOpenRoute;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

export function testManagedAccess(
  overrides: TestManagedAccessOverrides = {},
): DesktopManagedEnvironmentAccess {
  return {
    ...defaultDesktopManagedEnvironmentAccess(),
    ...overrides,
  };
}

export function testManagedLocalEnvironment(
  name = 'default',
  options: TestManagedLocalEnvironmentOptions = {},
): DesktopManagedLocalEnvironment {
  return createManagedLocalEnvironment(name, {
    label: options.label,
    pinned: options.pinned,
    stateDir: options.stateDir ?? localManagedStateLayout(name).stateDir,
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
): DesktopManagedControlPlaneEnvironment {
  const layout = controlPlaneManagedStateLayout(providerOrigin, envPublicID);
  return createManagedControlPlaneEnvironment(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'redeven_portal',
    label: options.label,
    pinned: options.pinned,
    preferredOpenRoute: options.preferredOpenRoute,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
    localHosting: options.localHosting === false
      ? undefined
      : createManagedEnvironmentLocalHosting(
        {
          kind: 'local_environment',
          name: 'local',
        },
        {
          access: testManagedAccess(options.access),
          owner: options.owner ?? 'desktop',
          stateDir: options.stateDir ?? layout.stateDir,
          currentRuntime: options.currentRuntime,
        },
      ),
  });
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
  const managedEnvironments = options.managed_environments ?? base.managed_environments;
  const providerEnvironmentsByID = new Map(
    (options.provider_environments ?? base.provider_environments).map((environment) => [environment.id, environment] as const),
  );

  for (const environment of managedEnvironments) {
    if (!environment.provider_binding) {
      continue;
    }
    providerEnvironmentsByID.set(environment.id, testProviderEnvironment(
      environment.provider_binding.provider_origin,
      environment.provider_binding.env_public_id,
      {
        providerID: environment.provider_binding.provider_id,
        label: environment.label,
        pinned: environment.pinned,
        preferredOpenRoute: environment.preferred_open_route,
        createdAtMS: environment.created_at_ms,
        updatedAtMS: environment.updated_at_ms,
        lastUsedAtMS: environment.last_used_at_ms,
      },
    ));
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
    ...options,
    managed_environments: managedEnvironments.filter((environment) => managedEnvironmentKind(environment) === 'local'),
    provider_environments: [...providerEnvironmentsByID.values()],
  };
}

export function testManagedSession(
  environment: DesktopManagedEnvironment,
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
  const providerBinding = environment.provider_binding;
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
