import { defaultSavedEnvironmentLabel, desktopEnvironmentID } from './desktopPreferences';
import { normalizeLocalUIBaseURL } from './localUIURL';
import type { StartupReport } from './startup';

export type DesktopTargetKind = 'managed_local' | 'external_local_ui';
export type DesktopSessionKey = 'managed_local' | `url:${string}`;

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

export type DesktopSessionTarget = ManagedLocalDesktopTarget | ExternalLocalUIDesktopTarget;

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
