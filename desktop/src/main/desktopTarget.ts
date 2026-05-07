import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { StartupReport } from './startup';
import type {
  DesktopSessionRuntimeLaunchMode,
  DesktopSessionRuntimeLifecycleOwner,
} from './sessionRuntime';
import {
  desktopProviderEnvironmentStateID,
  localEnvironmentDefaultOpenRoute,
  localEnvironmentStateKind,
  type DesktopLocalEnvironmentState,
} from '../shared/desktopLocalEnvironmentState';
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID as buildSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type { DesktopProviderEnvironmentRecord } from '../shared/desktopProviderEnvironment';

export type DesktopTargetKind = 'local_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopLocalEnvironmentStateSessionRoute = 'local_host' | 'remote_desktop';
export type DesktopSessionKey = `env:${string}:${DesktopLocalEnvironmentStateSessionRoute}` | `url:${string}` | `ssh:${string}`;
export type DesktopSessionLifecycle = 'opening' | 'open' | 'closing';

export type LocalEnvironmentDesktopTarget = Readonly<{
  kind: 'local_environment';
  session_key: DesktopSessionKey;
  environment_id: string;
  label: string;
  route: DesktopLocalEnvironmentStateSessionRoute;
  local_environment_kind: 'local' | 'controlplane';
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
  connect_timeout_seconds?: number | null;
  forwarded_local_ui_url: string;
}>;

export type DesktopSessionTarget = LocalEnvironmentDesktopTarget | ExternalLocalUIDesktopTarget | SSHDesktopTarget;

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

export function localEnvironmentDesktopSessionKey(
  environmentID: string,
  route: DesktopLocalEnvironmentStateSessionRoute,
): `env:${string}:${DesktopLocalEnvironmentStateSessionRoute}` {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '') {
    throw new Error('Environment ID is required.');
  }
  return `env:${encodeURIComponent(cleanEnvironmentID)}:${route}`;
}

function linkedLocalEnvironmentSessionIdentityFromParts(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): string {
  return [
    'linked-local',
    providerOrigin,
    providerID,
    envPublicID,
  ].map(encodeURIComponent).join(':');
}

function linkedLocalEnvironmentSessionIdentity(environment: DesktopLocalEnvironmentState): string {
  const binding = environment.current_provider_binding;
  if (!binding) {
    return compact(environment.id);
  }
  return linkedLocalEnvironmentSessionIdentityFromParts(
    binding.provider_origin,
    binding.provider_id,
    binding.env_public_id,
  );
}

export function controlPlaneDesktopSessionKey(
  rawProviderOrigin: string,
  rawEnvPublicID: string,
): `env:${string}:remote_desktop` {
  return `env:${encodeURIComponent(desktopProviderEnvironmentStateID(rawProviderOrigin, rawEnvPublicID))}:remote_desktop`;
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

type BuildLocalEnvironmentDesktopTargetOptions = Readonly<{
  route?: DesktopLocalEnvironmentStateSessionRoute;
}>;

export function buildLocalEnvironmentDesktopTarget(
  environment: DesktopLocalEnvironmentState,
  options: BuildLocalEnvironmentDesktopTargetOptions = {},
): LocalEnvironmentDesktopTarget {
  const route = options.route ?? (
    localEnvironmentDefaultOpenRoute(environment) === 'remote_desktop'
      ? 'remote_desktop'
      : 'local_host'
  );
  return {
    kind: 'local_environment',
    session_key: localEnvironmentDesktopSessionKey(
      route === 'local_host'
        ? linkedLocalEnvironmentSessionIdentity(environment)
        : environment.id,
      route,
    ),
    environment_id: environment.id,
    label: environment.label,
    route,
    local_environment_kind: localEnvironmentStateKind(environment),
    provider_origin: environment.current_provider_binding?.provider_origin,
    provider_id: environment.current_provider_binding?.provider_id,
    env_public_id: environment.current_provider_binding?.env_public_id,
    has_local_hosting: true,
    has_remote_desktop: environment.current_provider_binding?.remote_desktop_supported === true,
  };
}

export function buildProviderEnvironmentDesktopTarget(
  environment: DesktopProviderEnvironmentRecord,
  options: BuildLocalEnvironmentDesktopTargetOptions = {},
): LocalEnvironmentDesktopTarget {
  const route = options.route ?? 'remote_desktop';
  const sessionIdentity = route === 'local_host'
    ? linkedLocalEnvironmentSessionIdentityFromParts(
        environment.provider_origin,
        environment.provider_id,
        environment.env_public_id,
      )
    : environment.id;
  return {
    kind: 'local_environment',
    session_key: localEnvironmentDesktopSessionKey(sessionIdentity, route),
    environment_id: environment.id,
    label: environment.label,
    route,
    local_environment_kind: 'controlplane',
    provider_origin: environment.provider_origin,
    provider_id: environment.provider_id,
    env_public_id: environment.env_public_id,
    has_local_hosting: route === 'local_host',
    has_remote_desktop: environment.remote_desktop_supported === true,
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
    connect_timeout_seconds: details.connect_timeout_seconds,
    forwarded_local_ui_url: forwardedLocalUIURL,
  };
}
