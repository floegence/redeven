import type { DesktopPreferences } from '../main/desktopPreferences';
import { defaultDesktopPreferences } from '../main/desktopPreferences';
import {
  buildManagedEnvironmentDesktopTarget,
  managedEnvironmentDesktopSessionKey,
  type DesktopSessionSummary,
} from '../main/desktopTarget';
import type { StartupReport } from '../main/startup';
import {
  createManagedControlPlaneEnvironment,
  createManagedLocalEnvironment,
  defaultDesktopManagedEnvironmentAccess,
  type DesktopManagedControlPlaneEnvironment,
  type DesktopManagedEnvironment,
  type DesktopManagedEnvironmentAccess,
  type DesktopManagedLocalEnvironment,
} from '../shared/desktopManagedEnvironment';

type TestManagedAccessOverrides = Partial<DesktopManagedEnvironmentAccess>;

type TestManagedLocalEnvironmentOptions = Readonly<{
  label?: string;
  access?: TestManagedAccessOverrides;
  pinned?: boolean;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestManagedControlPlaneEnvironmentOptions = Readonly<{
  providerID?: string;
  label?: string;
  access?: TestManagedAccessOverrides;
  pinned?: boolean;
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
  return createManagedControlPlaneEnvironment(providerOrigin, envPublicID, {
    providerID: options.providerID ?? 'redeven_portal',
    label: options.label,
    pinned: options.pinned,
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
    access: testManagedAccess(options.access),
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
  startupOverrides: Partial<StartupReport> = {},
): DesktopSessionSummary {
  return {
    session_key: managedEnvironmentDesktopSessionKey(environment),
    target: buildManagedEnvironmentDesktopTarget(environment),
    startup: {
      local_ui_url: localUIURL,
      local_ui_urls: [localUIURL],
      ...startupOverrides,
    },
  };
}
