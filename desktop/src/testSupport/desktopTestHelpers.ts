import type {
  DesktopPreferences,
  DesktopSavedEnvironment,
  DesktopSavedRuntimeTarget,
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
} from '../main/sessionRuntime';
import type { StartupReport } from '../main/startup';
import type { DesktopSessionTransportKind } from '../main/desktopSessionTransport';
import {
  projectCloudEnvironmentToLocalRuntimeTarget,
  createDesktopLocalEnvironmentState,
  defaultDesktopLocalEnvironmentAccess,
  type DesktopLocalEnvironmentAccess,
  type DesktopLocalEnvironmentPreferredOpenRoute,
  type DesktopLocalEnvironmentRuntimeState,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  createDesktopCloudEnvironmentRecord,
  type DesktopCloudEnvironmentRecord,
} from '../shared/desktopCloudEnvironment';

type TestLocalAccessOverrides = Partial<DesktopLocalEnvironmentAccess>;

type TestLocalEnvironmentOptions = Readonly<{
  label?: string;
  access?: TestLocalAccessOverrides;
  pinned?: boolean;
  autoRuntimeProbeEnabled?: boolean;
  stateDir?: string;
  preferredOpenRoute?: DesktopLocalEnvironmentPreferredOpenRoute;
  currentRuntime?: Partial<DesktopLocalEnvironmentRuntimeState> | null;
  createdAtMS?: number;
  updatedAtMS?: number;
  lastUsedAtMS?: number;
}>;

type TestProviderBoundLocalEnvironmentOptions = Readonly<{
  cloudID?: string;
  region?: string;
  accessPointID?: string;
  accessPointOrigin?: string;
  label?: string;
  access?: TestLocalAccessOverrides;
  pinned?: boolean;
  autoRuntimeProbeEnabled?: boolean;
  stateDir?: string;
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
type TestSavedRuntimeTargetInput =
  | DesktopSavedRuntimeTarget
  | Omit<DesktopSavedRuntimeTarget, 'auto_runtime_probe_enabled'> & Partial<Pick<DesktopSavedRuntimeTarget, 'auto_runtime_probe_enabled'>>;

type TestDesktopPreferencesOptions = Readonly<Omit<Partial<DesktopPreferences>, 'saved_environments' | 'saved_runtime_targets'> & {
  local_environment?: DesktopLocalEnvironmentState;
  saved_environments?: readonly TestSavedEnvironmentInput[];
  saved_runtime_targets?: readonly TestSavedRuntimeTargetInput[];
}>;

type TestCloudEnvironmentOptions = Readonly<{
  cloudID?: string;
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
  return runtime;
}

function defaultTestAccessPointOrigin(cloudOrigin: string): string {
  try {
    const parsed = new URL(cloudOrigin);
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
    preferredOpenRoute: options.preferredOpenRoute,
    currentRuntime: testCurrentRuntime(options.currentRuntime),
    createdAtMS: options.createdAtMS,
    updatedAtMS: options.updatedAtMS,
    lastUsedAtMS: options.lastUsedAtMS,
    access: testLocalAccess(options.access),
  });
}

export function testProviderBoundLocalEnvironment(
  cloudOrigin: string,
  envPublicID: string,
  options: TestProviderBoundLocalEnvironmentOptions = {},
): DesktopLocalEnvironmentState {
  const layout = localEnvironmentStateLayout();
  const providerEnvironment = testCloudEnvironment(cloudOrigin, envPublicID, {
    cloudID: options.cloudID ?? 'example_control_plane',
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
  return projectCloudEnvironmentToLocalRuntimeTarget(
    providerEnvironment,
    testLocalEnvironment({
      access: options.access,
      autoRuntimeProbeEnabled: options.autoRuntimeProbeEnabled,
      stateDir: options.stateDir ?? layout.stateDir,
      currentRuntime: testCurrentRuntime(options.currentRuntime),
      createdAtMS: options.createdAtMS,
      updatedAtMS: options.updatedAtMS,
      lastUsedAtMS: options.lastUsedAtMS,
    }),
  );
}

export function testCloudEnvironment(
  cloudOrigin: string,
  envPublicID: string,
  options: TestCloudEnvironmentOptions = {},
): DesktopCloudEnvironmentRecord {
  const region = options.region ?? 'dev';
  const accessPointID = options.accessPointID ?? region;
  return createDesktopCloudEnvironmentRecord(cloudOrigin, envPublicID, {
    cloudID: options.cloudID ?? 'example_control_plane',
    region,
    accessPointID,
    accessPointOrigin: options.accessPointOrigin ?? defaultTestAccessPointOrigin(cloudOrigin),
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
  const hasExplicitCloudEnvironments = Object.hasOwn(options, 'cloud_environments');
  const providerEnvironmentsByID = new Map(
    (options.cloud_environments ?? base.cloud_environments).map((environment) => [environment.id, environment] as const),
  );

  const localProviderBinding = localEnvironment.current_cloud_binding;
  if (localProviderBinding && !hasExplicitCloudEnvironments) {
    const providerEnvironment = testCloudEnvironment(
      localProviderBinding.cloud_origin,
      localProviderBinding.env_public_id,
      {
        cloudID: localProviderBinding.cloud_id,
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
    cloud_environments: [...providerEnvironmentsByID.values()],
    saved_environments: (options.saved_environments ?? base.saved_environments).map(normalizeTestSavedEnvironment),
    saved_runtime_targets: (options.saved_runtime_targets ?? base.saved_runtime_targets).map(normalizeTestSavedRuntimeTarget),
  };
}

export function testLocalEnvironmentSession(
  environment: DesktopLocalEnvironmentState,
  localUIURL: string,
  lifecycle: DesktopSessionLifecycle = 'open',
  startupOverrides: Partial<StartupReport> = {},
  options: Readonly<{
    runtimeLaunchMode?: DesktopSessionRuntimeLaunchMode;
    transportKind?: DesktopSessionTransportKind;
  }> = {},
): DesktopSessionSummary {
  const target = buildLocalEnvironmentDesktopTarget(environment);
  const effectiveRunMode = String(startupOverrides.effective_run_mode ?? 'desktop');
  const remoteEnabled = startupOverrides.remote_enabled === true;
  const currentProviderBinding = environment.current_cloud_binding;
  return {
    session_key: target.session_key,
    target,
    lifecycle,
    entry_url: localUIURL,
    startup: {
      local_ui_url: localUIURL,
      local_ui_urls: [localUIURL],
      local_ui_bridge_url: localUIURL,
      local_ui_bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ...(currentProviderBinding ? {
        cloud_origin: currentProviderBinding.cloud_origin,
        access_point_origin: currentProviderBinding.access_point_origin,
        cloud_id: currentProviderBinding.cloud_id,
        env_public_id: currentProviderBinding.env_public_id,
      } : {}),
      runtime_service: {
        protocol_version: 'redeven-runtime-v2',
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
    runtime_launch_mode: options.runtimeLaunchMode,
    transport_kind: options.transportKind,
  };
}
