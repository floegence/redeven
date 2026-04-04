import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import { normalizeControlPlaneOrigin } from '../shared/controlPlaneProvider';
import {
  defaultSavedSSHEnvironmentLabel,
  desktopSSHEnvironmentID,
  desktopSSHEnvironmentID as buildSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentDetails,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import type { StartupReport } from './startup';

export type DesktopTargetKind = 'managed_local' | 'external_local_ui' | 'ssh_environment' | 'controlplane_environment';
export type DesktopSessionKey = 'managed_local' | `url:${string}` | `ssh:${string}` | `cp:${string}:env:${string}`;

export type ManagedLocalDesktopTarget = Readonly<{
  kind: 'managed_local';
  session_key: 'managed_local';
  environment_id: 'env_local';
  label: 'Local Environment';
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
  forwarded_local_ui_url: string;
}>;

export type ControlPlaneDesktopTarget = Readonly<{
  kind: 'controlplane_environment';
  session_key: `cp:${string}:env:${string}`;
  environment_id: string;
  provider_id: string;
  provider_origin: string;
  env_public_id: string;
  label: string;
}>;

export type DesktopSessionTarget = ManagedLocalDesktopTarget | ExternalLocalUIDesktopTarget | SSHDesktopTarget | ControlPlaneDesktopTarget;

export type DesktopSessionSummary = Readonly<{
  session_key: DesktopSessionKey;
  target: DesktopSessionTarget;
  startup: StartupReport;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function managedLocalDesktopSessionKey(): 'managed_local' {
  return 'managed_local';
}

export function externalLocalUIDesktopSessionKey(rawURL: string): DesktopSessionKey {
  return `url:${normalizeLocalUIBaseURL(rawURL)}`;
}

export function sshDesktopSessionKey(rawDetails: DesktopSSHEnvironmentDetails): `ssh:${string}` {
  return desktopSSHEnvironmentID(rawDetails);
}

export function controlPlaneDesktopSessionKey(rawProviderOrigin: string, rawEnvPublicID: string): `cp:${string}:env:${string}` {
  const providerOrigin = normalizeControlPlaneOrigin(rawProviderOrigin);
  const envPublicID = compact(rawEnvPublicID);
  if (envPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  return `cp:${encodeURIComponent(providerOrigin)}:env:${encodeURIComponent(envPublicID)}`;
}

export function desktopSessionStateKeyFragment(sessionKey: DesktopSessionKey): string {
  return encodeURIComponent(String(sessionKey ?? '').trim());
}

export function buildManagedLocalDesktopTarget(): ManagedLocalDesktopTarget {
  return {
    kind: 'managed_local',
    session_key: managedLocalDesktopSessionKey(),
    environment_id: 'env_local',
    label: 'Local Environment',
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
    forwarded_local_ui_url: forwardedLocalUIURL,
  };
}

type BuildControlPlaneDesktopTargetOptions = Readonly<{
  environmentID?: string;
  label?: string;
  providerID: string;
}>;

export function buildControlPlaneDesktopTarget(
  rawProviderOrigin: string,
  rawEnvPublicID: string,
  options: BuildControlPlaneDesktopTargetOptions,
): ControlPlaneDesktopTarget {
  const providerOrigin = normalizeControlPlaneOrigin(rawProviderOrigin);
  const envPublicID = compact(rawEnvPublicID);
  if (envPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  const providerID = compact(options.providerID);
  if (providerID === '') {
    throw new Error('Provider ID is required.');
  }
  const environmentID = compact(options.environmentID) || envPublicID;
  return {
    kind: 'controlplane_environment',
    session_key: controlPlaneDesktopSessionKey(providerOrigin, envPublicID),
    environment_id: environmentID,
    provider_id: providerID,
    provider_origin: providerOrigin,
    env_public_id: envPublicID,
    label: compact(options.label) || envPublicID,
  };
}
