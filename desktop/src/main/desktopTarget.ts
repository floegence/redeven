import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { StartupReport } from './startup';
import type {
  DesktopSessionRuntimeLaunchMode,
  DesktopSessionRuntimeLifecycleOwner,
} from './sessionRuntime';
import {
  desktopManagedControlPlaneEnvironmentID,
  managedEnvironmentDefaultOpenRoute,
  managedEnvironmentKind,
  normalizeDesktopLocalEnvironmentName,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID as buildSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';

export type DesktopTargetKind = 'managed_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopManagedEnvironmentSessionRoute = 'local_host' | 'remote_desktop';
export type DesktopSessionKey = `env:${string}:${DesktopManagedEnvironmentSessionRoute}` | `url:${string}` | `ssh:${string}`;
export type DesktopSessionLifecycle = 'opening' | 'open' | 'closing';

export type ManagedEnvironmentDesktopTarget = Readonly<{
  kind: 'managed_environment';
  session_key: DesktopSessionKey;
  environment_id: string;
  label: string;
  route: DesktopManagedEnvironmentSessionRoute;
  managed_environment_kind: 'local' | 'controlplane';
  local_environment_name?: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  has_local_hosting: boolean;
  has_remote_desktop: boolean;
}>;

export type ExternalLocalUIDesktopTarget = Readonly<{
  kind: 'external_local_ui';
  session_key: DesktopSessionKey;
  environment_id: string;
  external_local_ui_url: string;
  label: string;
}>;

export type SSHDesktopTarget = Readonly<{
  kind: 'ssh_environment';
  session_key: `ssh:${string}`;
  environment_id: string;
  label: string;
  ssh_destination: string;
  ssh_port: number | null;
  auth_mode: DesktopSSHEnvironmentDetails['auth_mode'];
  remote_install_dir: string;
  bootstrap_strategy: DesktopSSHEnvironmentDetails['bootstrap_strategy'];
  release_base_url: string;
  forwarded_local_ui_url: string;
}>;

export type DesktopSessionTarget = ManagedEnvironmentDesktopTarget | ExternalLocalUIDesktopTarget | SSHDesktopTarget;

export type DesktopSessionSummary = Readonly<{
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  lifecycle: DesktopSessionLifecycle;
  entry_url?: string;
  startup?: StartupReport;
  runtime_lifecycle_owner?: DesktopSessionRuntimeLifecycleOwner;
  runtime_launch_mode?: DesktopSessionRuntimeLaunchMode;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function managedEnvironmentDesktopSessionKey(
  environmentID: string,
  route: DesktopManagedEnvironmentSessionRoute,
): `env:${string}:${DesktopManagedEnvironmentSessionRoute}` {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '') {
    throw new Error('Environment ID is required.');
  }
  return `env:${encodeURIComponent(cleanEnvironmentID)}:${route}`;
}

function providerManagedEnvironmentSessionIdentity(environment: DesktopManagedEnvironment): string {
  const binding = environment.provider_binding;
  if (!binding) {
    return compact(environment.id);
  }
  return [
    'provider-local',
    binding.provider_origin,
    binding.provider_id,
    binding.env_public_id,
  ].map(encodeURIComponent).join(':');
}

export function controlPlaneDesktopSessionKey(
  rawProviderOrigin: string,
  rawEnvPublicID: string,
): `env:${string}:remote_desktop` {
  return `env:${encodeURIComponent(desktopManagedControlPlaneEnvironmentID(rawProviderOrigin, rawEnvPublicID))}:remote_desktop`;
}

export function externalLocalUIDesktopSessionKey(rawURL: string): DesktopSessionKey {
  return `url:${normalizeLocalUIBaseURL(rawURL)}`;
}

export function sshDesktopSessionKey(rawDetails: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  return buildSSHEnvironmentID(rawDetails);
}

export function desktopSessionStateKeyFragment(sessionKey: DesktopSessionKey): string {
  return encodeURIComponent(String(sessionKey ?? '').trim());
}

type BuildManagedEnvironmentDesktopTargetOptions = Readonly<{
  route?: DesktopManagedEnvironmentSessionRoute;
}>;

export function buildManagedEnvironmentDesktopTarget(
  environment: DesktopManagedEnvironment,
  options: BuildManagedEnvironmentDesktopTargetOptions = {},
): ManagedEnvironmentDesktopTarget {
  const route = options.route ?? (
    managedEnvironmentDefaultOpenRoute(environment) === 'remote_desktop'
      ? 'remote_desktop'
      : 'local_host'
  );
  const localScope = environment.local_hosting?.scope;
  return {
    kind: 'managed_environment',
    session_key: managedEnvironmentDesktopSessionKey(
      route === 'local_host'
        ? providerManagedEnvironmentSessionIdentity(environment)
        : environment.id,
      route,
    ),
    environment_id: environment.id,
    label: environment.label,
    route,
    managed_environment_kind: managedEnvironmentKind(environment),
    local_environment_name: localScope
      ? normalizeDesktopLocalEnvironmentName(localScope.name)
      : undefined,
    provider_origin: environment.provider_binding?.provider_origin,
    provider_id: environment.provider_binding?.provider_id,
    env_public_id: environment.provider_binding?.env_public_id,
    has_local_hosting: Boolean(environment.local_hosting),
    has_remote_desktop: environment.provider_binding?.remote_desktop_supported === true,
  };
}

type BuildExternalLocalUIDesktopTargetOptions = Readonly<{
  environmentID?: string;
  label?: string;
}>;

export function buildExternalLocalUIDesktopTarget(
  rawURL: string,
  options: BuildExternalLocalUIDesktopTargetOptions = {},
): ExternalLocalUIDesktopTarget {
  const normalizedURL = normalizeLocalUIBaseURL(rawURL);
  const environmentID = compact(options.environmentID) || desktopEnvironmentID(normalizedURL);
  return {
    kind: 'external_local_ui',
    session_key: externalLocalUIDesktopSessionKey(normalizedURL),
    environment_id: environmentID,
    external_local_ui_url: normalizedURL,
    label: compact(options.label) || defaultSavedEnvironmentLabel(normalizedURL),
  };
}

type BuildSSHDesktopTargetOptions = Readonly<{
  environmentID?: string;
  label?: string;
  forwardedLocalUIURL: string;
}>;

export function buildSSHDesktopTarget(
  rawDetails: DesktopSSHEnvironmentDetails,
  options: BuildSSHDesktopTargetOptions,
): SSHDesktopTarget {
  const details = normalizeDesktopSSHEnvironmentDetails(rawDetails);
  const forwardedLocalUIURL = normalizeLocalUIBaseURL(options.forwardedLocalUIURL);
  const environmentID = compact(options.environmentID) || buildSSHEnvironmentID(details);
  return {
    kind: 'ssh_environment',
    session_key: sshDesktopSessionKey(details),
    environment_id: environmentID,
    label: compact(options.label) || defaultSavedSSHEnvironmentLabel(details),
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    auth_mode: details.auth_mode,
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    forwarded_local_ui_url: forwardedLocalUIURL,
  };
}
