import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { StartupReport } from './startup';
import type { DesktopSessionTransportKind } from './desktopSessionTransport';
import type { DesktopSessionRuntimeLaunchMode } from './sessionRuntime';
import {
  desktopCloudEnvironmentStateID,
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
import type { DesktopCloudEnvironmentRecord } from '../shared/desktopCloudEnvironment';
import type { DesktopRuntimeHostAccess, DesktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

export type DesktopTargetKind = 'local_environment' | 'wsl_environment' | 'external_local_ui' | 'ssh_environment' | 'gateway_environment';
export type DesktopLocalEnvironmentStateSessionRoute = 'local_host' | 'remote_desktop';
export type DesktopSessionKey = `env:${string}:${DesktopLocalEnvironmentStateSessionRoute}` | `url:${string}` | `wsl:${string}` | `ssh:${string}` | `gateway:${string}:env:${string}:session:${string}`;
export type DesktopSessionLifecycle = 'opening' | 'open' | 'closing';

export type LocalEnvironmentDesktopTarget = Readonly<{
  kind: 'local_environment';
  session_key: DesktopSessionKey;
  environment_id: string;
  label: string;
  route: DesktopLocalEnvironmentStateSessionRoute;
  local_environment_kind: 'local' | 'controlplane';
  cloud_origin?: string;
  cloud_id?: string;
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
  runtime_root: string;
  bootstrap_strategy: DesktopSSHEnvironmentDetails['bootstrap_strategy'];
  release_base_url: string;
  connect_timeout_seconds?: number | null;
}>;

export type WSLDesktopTarget = Readonly<{
  kind: 'wsl_environment';
  session_key: `wsl:${string}`;
  environment_id: DesktopRuntimeTargetID;
  label: string;
  distribution_name: string;
  linux_user: string;
}>;

export type GatewayDesktopTarget = Readonly<{
  kind: 'gateway_environment';
  session_key: `gateway:${string}:env:${string}:session:${string}`;
  environment_id: string;
  label: string;
  gateway_id: string;
  gateway_label: string;
  gateway_env_id: string;
  gateway_session_id: string;
}>;

export type DesktopSessionTarget = LocalEnvironmentDesktopTarget | WSLDesktopTarget | ExternalLocalUIDesktopTarget | SSHDesktopTarget | GatewayDesktopTarget;

export type DesktopSessionSummary = Readonly<{
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  lifecycle: DesktopSessionLifecycle;
  entry_url?: string;
  startup?: StartupReport;
  runtime_launch_mode?: DesktopSessionRuntimeLaunchMode;
  /** Main-process transport classification used to keep private bridges out of user endpoints. */
  transport_kind?: DesktopSessionTransportKind;
}>;

function matchingOptionalIdentity(left: string | undefined, right: string | undefined): boolean {
  const cleanLeft = compact(left);
  const cleanRight = compact(right);
  return cleanLeft !== '' && cleanLeft === cleanRight;
}

export function desktopSessionTargetsReferToSameEnvironment(
  left: DesktopSessionTarget,
  right: DesktopSessionTarget,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'local_environment' && right.kind === 'local_environment') {
    return compact(left.environment_id) === compact(right.environment_id) || (
      matchingOptionalIdentity(left.cloud_origin, right.cloud_origin)
      && matchingOptionalIdentity(left.cloud_id, right.cloud_id)
      && matchingOptionalIdentity(left.env_public_id, right.env_public_id)
    );
  }
  if (left.kind === 'external_local_ui' && right.kind === 'external_local_ui') {
    return compact(left.environment_id) === compact(right.environment_id)
      || normalizeLocalUIBaseURL(left.external_local_ui_url) === normalizeLocalUIBaseURL(right.external_local_ui_url);
  }
  if (left.kind === 'ssh_environment' && right.kind === 'ssh_environment') {
    return left.session_key === right.session_key;
  }
  if (left.kind === 'wsl_environment' && right.kind === 'wsl_environment') {
    return left.session_key === right.session_key;
  }
  if (left.kind === 'gateway_environment' && right.kind === 'gateway_environment') {
    return compact(left.gateway_id) === compact(right.gateway_id)
      && compact(left.gateway_env_id) === compact(right.gateway_env_id);
  }
  return false;
}

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
  cloudOrigin: string,
  cloudID: string,
  envPublicID: string,
): string {
  return [
    'linked-local',
    cloudOrigin,
    cloudID,
    envPublicID,
  ].map(encodeURIComponent).join(':');
}

function linkedLocalEnvironmentSessionIdentity(environment: DesktopLocalEnvironmentState): string {
  const binding = environment.current_cloud_binding;
  if (!binding) {
    return compact(environment.id);
  }
  return linkedLocalEnvironmentSessionIdentityFromParts(
    binding.cloud_origin,
    binding.cloud_id,
    binding.env_public_id,
  );
}

export function controlPlaneDesktopSessionKey(
  rawCloudOrigin: string,
  rawEnvPublicID: string,
): `env:${string}:remote_desktop` {
  return `env:${encodeURIComponent(desktopCloudEnvironmentStateID(rawCloudOrigin, rawEnvPublicID))}:remote_desktop`;
}

export function externalLocalUIDesktopSessionKey(rawURL: string): DesktopSessionKey {
  return `url:${normalizeLocalUIBaseURL(rawURL)}`;
}

export function sshDesktopSessionKey(rawDetails: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  return buildSSHEnvironmentID(rawDetails);
}

export function wslDesktopSessionKey(targetID: DesktopRuntimeTargetID): `wsl:${string}` {
  if (!targetID.startsWith('wsl:')) {
    throw new Error('WSL Runtime target ID is required.');
  }
  return targetID as `wsl:${string}`;
}

export function gatewayDesktopSessionKey(
  gatewayID: string,
  gatewayEnvID: string,
  gatewaySessionID: string,
): `gateway:${string}:env:${string}:session:${string}` {
  const cleanGatewayID = compact(gatewayID);
  const cleanGatewayEnvID = compact(gatewayEnvID);
  const cleanGatewaySessionID = compact(gatewaySessionID);
  if (cleanGatewayID === '' || cleanGatewayEnvID === '' || cleanGatewaySessionID === '') {
    throw new Error('Gateway id, environment id, and session id are required.');
  }
  return `gateway:${encodeURIComponent(cleanGatewayID)}:env:${encodeURIComponent(cleanGatewayEnvID)}:session:${encodeURIComponent(cleanGatewaySessionID)}`;
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
    cloud_origin: environment.current_cloud_binding?.cloud_origin,
    cloud_id: environment.current_cloud_binding?.cloud_id,
    env_public_id: environment.current_cloud_binding?.env_public_id,
    has_local_hosting: true,
    has_remote_desktop: environment.current_cloud_binding?.remote_desktop_supported === true,
  };
}

export function buildCloudEnvironmentDesktopTarget(
  environment: DesktopCloudEnvironmentRecord,
  options: BuildLocalEnvironmentDesktopTargetOptions = {},
): LocalEnvironmentDesktopTarget {
  const route = options.route ?? 'remote_desktop';
  const sessionIdentity = route === 'local_host'
    ? linkedLocalEnvironmentSessionIdentityFromParts(
        environment.cloud_origin,
        environment.cloud_id,
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
    cloud_origin: environment.cloud_origin,
    cloud_id: environment.cloud_id,
    env_public_id: environment.env_public_id,
    has_local_hosting: route === 'local_host',
    has_remote_desktop: environment.remote_desktop_supported === true,
  };
}

export function buildManagedLocalRuntimeDesktopTarget(
  environmentID: string,
  label: string,
): LocalEnvironmentDesktopTarget {
  const cleanEnvironmentID = compact(environmentID);
  if (cleanEnvironmentID === '') {
    throw new Error('Environment ID is required.');
  }
  return {
    kind: 'local_environment',
    session_key: localEnvironmentDesktopSessionKey(cleanEnvironmentID, 'local_host'),
    environment_id: cleanEnvironmentID,
    label: compact(label) || 'Local Runtime',
    route: 'local_host',
    local_environment_kind: 'local',
    has_local_hosting: true,
    has_remote_desktop: false,
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
  sessionKeyOverride?: `ssh:${string}`;
}>;

export function buildSSHDesktopTarget(
  rawDetails: DesktopSSHEnvironmentDetails,
  options: BuildSSHDesktopTargetOptions,
): SSHDesktopTarget {
  const details = normalizeDesktopSSHEnvironmentDetails(rawDetails);
  const environmentID = compact(options.environmentID) || buildSSHEnvironmentID(details);
  return {
    kind: 'ssh_environment',
    session_key: options.sessionKeyOverride ?? sshDesktopSessionKey(details),
    environment_id: environmentID,
    label: compact(options.label) || defaultSavedSSHEnvironmentLabel(details),
    ssh_destination: details.ssh_destination,
    ssh_port: details.ssh_port,
    auth_mode: details.auth_mode,
    runtime_root: details.runtime_root,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    connect_timeout_seconds: details.connect_timeout_seconds,
  };
}

export function buildWSLDesktopTarget(
  hostAccess: Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'wsl_host' }>>,
  targetID: DesktopRuntimeTargetID,
  label: string,
): WSLDesktopTarget {
  return {
    kind: 'wsl_environment',
    session_key: wslDesktopSessionKey(targetID),
    environment_id: targetID,
    label: compact(label) || hostAccess.distribution_name,
    distribution_name: hostAccess.distribution_name,
    linux_user: hostAccess.linux_user,
  };
}

export function buildGatewayDesktopTarget(input: Readonly<{
  gatewayID: string;
  gatewayLabel?: string;
  gatewayEnvID: string;
  label?: string;
  gatewaySessionID?: string;
}>): GatewayDesktopTarget {
  const gatewayID = compact(input.gatewayID);
  const gatewayEnvID = compact(input.gatewayEnvID);
  const gatewaySessionID = compact(input.gatewaySessionID);
  if (gatewayID === '' || gatewayEnvID === '' || gatewaySessionID === '') {
    throw new Error('Gateway id, environment id, and session id are required.');
  }
  const label = compact(input.label) || gatewayEnvID;
  return {
    kind: 'gateway_environment',
    session_key: gatewayDesktopSessionKey(gatewayID, gatewayEnvID, gatewaySessionID),
    environment_id: `gateway:${gatewayID}:env:${gatewayEnvID}`,
    label,
    gateway_id: gatewayID,
    gateway_label: compact(input.gatewayLabel) || gatewayID,
    gateway_env_id: gatewayEnvID,
    gateway_session_id: gatewaySessionID,
  };
}

export function desktopSessionKeyFromRuntimeTargetID(
  runtimeTargetID: DesktopRuntimeTargetID,
): DesktopSessionKey {
  const clean = compact(runtimeTargetID);
  if (!clean.startsWith('local:') && !clean.startsWith('wsl:') && !clean.startsWith('ssh:')) {
    throw new Error('Runtime target ID is required.');
  }
  return clean.startsWith('ssh:')
    ? clean as `ssh:${string}`
    : clean.startsWith('wsl:')
      ? wslDesktopSessionKey(clean as DesktopRuntimeTargetID)
    : localEnvironmentDesktopSessionKey(clean, 'local_host');
}
