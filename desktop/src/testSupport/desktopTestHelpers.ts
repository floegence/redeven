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
  type DesktopManagedControlPlaneEnvironment,
  type DesktopManagedEnvironment,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedEnvironmentLocalOwner,
  type DesktopManagedEnvironmentPreferredOpenRoute,
  type DesktopManagedEnvironmentRuntimeState,
  type DesktopManagedLocalEnvironment,
} from '../shared/desktopManagedEnvironment';

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
  const scopeParts = layout.scopeKey.split('/');
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
          kind: 'controlplane',
          provider_origin: providerOrigin,
          provider_key: scopeParts[1] ?? 'redeven_portal',
          env_public_id: envPublicID,
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

export function testDesktopPreferences(
  options: TestDesktopPreferencesOptions = {},
): DesktopPreferences {
  const base = defaultDesktopPreferences();
  return {
    ...base,
    ...options,
    managed_environments: options.managed_environments ?? base.managed_environments,
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
  return {
    session_key: target.session_key,
    target,
    lifecycle,
    entry_url: localUIURL,
    startup: {
      local_ui_url: localUIURL,
      local_ui_urls: [localUIURL],
      ...startupOverrides,
    },
    runtime_lifecycle_owner: options.runtimeLifecycleOwner,
    runtime_launch_mode: options.runtimeLaunchMode,
  };
}
