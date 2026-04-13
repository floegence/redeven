import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import { normalizeControlPlaneOrigin } from '../shared/controlPlaneProvider';
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID as buildSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopManagedControlPlaneEnvironmentID,
  desktopManagedLocalEnvironmentID,
  type DesktopManagedEnvironment,
} from '../shared/desktopManagedEnvironment';
import type { StartupReport } from './startup';

export type DesktopTargetKind = 'managed_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopSessionKey = `local:${string}` | `url:${string}` | `ssh:${string}` | `cp:${string}:env:${string}`;

export type ManagedEnvironmentDesktopTarget = Readonly<{
  kind: 'managed_environment';
  session_key: DesktopSessionKey;
  environment_id: string;
  label: string;
  managed_environment_kind: DesktopManagedEnvironment['kind'];
  local_environment_name?: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
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
  remote_install_dir: string;
  bootstrap_strategy: DesktopSSHEnvironmentDetails['bootstrap_strategy'];
  release_base_url: string;
  forwarded_local_ui_url: string;
}>;

export type DesktopSessionTarget = ManagedEnvironmentDesktopTarget | ExternalLocalUIDesktopTarget | SSHDesktopTarget;

export type DesktopSessionSummary = Readonly<{
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  startup: StartupReport;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function localEnvironmentDesktopSessionKey(name: string): `local:${string}` {
  return desktopManagedLocalEnvironmentID(name) as `local:${string}`;
}

export function externalLocalUIDesktopSessionKey(rawURL: string): DesktopSessionKey {
  return `url:${normalizeLocalUIBaseURL(rawURL)}`;
}

export function sshDesktopSessionKey(rawDetails: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  return buildSSHEnvironmentID(rawDetails);
}

export function controlPlaneDesktopSessionKey(rawProviderOrigin: string, rawEnvPublicID: string): `cp:${string}:env:${string}` {
  return desktopManagedControlPlaneEnvironmentID(rawProviderOrigin, rawEnvPublicID) as `cp:${string}:env:${string}`;
}

export function desktopSessionStateKeyFragment(sessionKey: DesktopSessionKey): string {
  return encodeURIComponent(String(sessionKey ?? '').trim());
}

export function managedEnvironmentDesktopSessionKey(environment: DesktopManagedEnvironment): DesktopSessionKey {
  if (environment.kind === 'local') {
    return localEnvironmentDesktopSessionKey(environment.name);
  }
  return controlPlaneDesktopSessionKey(environment.provider_origin, environment.env_public_id);
}

export function buildManagedEnvironmentDesktopTarget(
  environment: DesktopManagedEnvironment,
): ManagedEnvironmentDesktopTarget {
  if (environment.kind === 'local') {
    return {
      kind: 'managed_environment',
      session_key: managedEnvironmentDesktopSessionKey(environment),
      environment_id: environment.id,
      label: environment.label,
      managed_environment_kind: environment.kind,
      local_environment_name: environment.name,
    };
  }
  return {
    kind: 'managed_environment',
    session_key: managedEnvironmentDesktopSessionKey(environment),
    environment_id: environment.id,
    label: environment.label,
    managed_environment_kind: environment.kind,
    provider_origin: normalizeControlPlaneOrigin(environment.provider_origin),
    provider_id: environment.provider_id,
    env_public_id: environment.env_public_id,
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
    remote_install_dir: details.remote_install_dir,
    bootstrap_strategy: details.bootstrap_strategy,
    release_base_url: details.release_base_url,
    forwarded_local_ui_url: forwardedLocalUIURL,
  };
}
