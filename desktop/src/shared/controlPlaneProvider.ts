import type {
  DesktopControlPlaneSyncState,
  DesktopProviderCatalogFreshness,
} from './providerEnvironmentState';

export type DesktopProviderProtocolVersion = 'rcpp-v1';

export type DesktopControlPlaneProvider = Readonly<{
  protocol_version: DesktopProviderProtocolVersion;
  provider_id: string;
  display_name: string;
  provider_origin: string;
  documentation_url: string;
}>;

export type DesktopControlPlaneAccount = Readonly<{
  provider_id: string;
  provider_origin: string;
  display_name: string;
  user_public_id: string;
  user_display_name: string;
  authorization_expires_at_unix_ms: number;
}>;

export type DesktopProviderEnvironment = Readonly<{
  provider_id: string;
  provider_origin: string;
  env_public_id: string;
  label: string;
  description: string;
  namespace_public_id: string;
  namespace_name: string;
  status: string;
  lifecycle_status: string;
  last_seen_at_unix_ms: number;
}>;

export type DesktopControlPlaneSummary = Readonly<{
  provider: DesktopControlPlaneProvider;
  account: DesktopControlPlaneAccount;
  environments: readonly DesktopProviderEnvironment[];
  display_label: string;
  last_synced_at_ms: number;
  sync_state: DesktopControlPlaneSyncState;
  last_sync_attempt_at_ms: number;
  last_sync_error_code: string;
  last_sync_error_message: string;
  catalog_freshness: DesktopProviderCatalogFreshness;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function suggestControlPlaneDisplayLabel(rawURL: string): string {
  const clean = compact(rawURL);
  if (clean === '') {
    return '';
  }
  try {
    const parsed = new URL(clean);
    return compact(parsed.hostname || parsed.host);
  } catch {
    return compact(
      clean
        .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u, '')
        .split('/')[0]
        ?.split('?')[0]
        ?.split('#')[0] ?? '',
    );
  }
}

export function defaultControlPlaneDisplayLabel(providerOrigin: string): string {
  const suggested = suggestControlPlaneDisplayLabel(normalizeControlPlaneOrigin(providerOrigin));
  return suggested === '' ? normalizeControlPlaneOrigin(providerOrigin) : suggested;
}

export function normalizeControlPlaneDisplayLabel(value: unknown, providerOrigin: string): string {
  const clean = compact(value);
  return clean === '' ? defaultControlPlaneDisplayLabel(providerOrigin) : clean;
}

export function normalizeControlPlaneOrigin(rawURL: string): string {
  const clean = compact(rawURL);
  if (clean === '') {
    throw new Error('Control Plane URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('Control Plane URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Control Plane URL must start with http:// or https://.');
  }
  if (compact(parsed.hostname) === '') {
    throw new Error('Control Plane URL must include a host.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Control Plane URL must not include embedded credentials.');
  }

  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

export function desktopControlPlaneKey(providerOrigin: string, providerID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedProviderID = compact(providerID);
  if (normalizedProviderID === '') {
    throw new Error('Provider ID is required.');
  }
  return `${normalizedOrigin}|${normalizedProviderID}`;
}

function normalizeProviderProtocolVersion(value: unknown): DesktopProviderProtocolVersion | null {
  return compact(value) === 'rcpp-v1' ? 'rcpp-v1' : null;
}

function normalizeUnixMS(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

export function normalizeDesktopControlPlaneProvider(value: unknown): DesktopControlPlaneProvider | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const protocolVersion = normalizeProviderProtocolVersion(candidate.protocol_version);
  if (!protocolVersion) {
    return null;
  }

  const providerID = compact(candidate.provider_id);
  const displayName = compact(candidate.display_name);
  const documentationURL = compact(candidate.documentation_url);
  if (providerID === '' || displayName === '' || documentationURL === '') {
    return null;
  }

  let providerOrigin = '';
  try {
    providerOrigin = normalizeControlPlaneOrigin(compact(candidate.provider_origin));
  } catch {
    return null;
  }

  return {
    protocol_version: protocolVersion,
    provider_id: providerID,
    display_name: displayName,
    provider_origin: providerOrigin,
    documentation_url: documentationURL,
  };
}

type NormalizeDesktopControlPlaneAccountOptions = Readonly<{
  provider: DesktopControlPlaneProvider;
}>;

export function normalizeDesktopControlPlaneAccount(
  value: unknown,
  options: NormalizeDesktopControlPlaneAccountOptions,
): DesktopControlPlaneAccount | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const userPublicID = compact(candidate.user_public_id);
  const userDisplayName = compact(candidate.user_display_name);
  const authorizationExpiresAtUnixMS = normalizeUnixMS(candidate.authorization_expires_at_unix_ms);
  if (userPublicID === '' || userDisplayName === '' || authorizationExpiresAtUnixMS <= 0) {
    return null;
  }

  return {
    provider_id: options.provider.provider_id,
    provider_origin: options.provider.provider_origin,
    display_name: options.provider.display_name,
    user_public_id: userPublicID,
    user_display_name: userDisplayName,
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
  };
}

type NormalizeDesktopProviderEnvironmentOptions = Readonly<{
  provider: DesktopControlPlaneProvider;
}>;

export function normalizeDesktopProviderEnvironment(
  value: unknown,
  options: NormalizeDesktopProviderEnvironmentOptions,
): DesktopProviderEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const envPublicID = compact(candidate.env_public_id);
  const label = compact(candidate.name);
  if (envPublicID === '' || label === '') {
    return null;
  }

  return {
    provider_id: options.provider.provider_id,
    provider_origin: options.provider.provider_origin,
    env_public_id: envPublicID,
    label,
    description: compact(candidate.description),
    namespace_public_id: compact(candidate.namespace_public_id),
    namespace_name: compact(candidate.namespace_name),
    status: compact(candidate.status),
    lifecycle_status: compact(candidate.lifecycle_status),
    last_seen_at_unix_ms: normalizeUnixMS(candidate.last_seen_at_unix_ms),
  };
}

export function normalizeDesktopProviderEnvironmentList(
  value: unknown,
  options: NormalizeDesktopProviderEnvironmentOptions,
): readonly DesktopProviderEnvironment[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const environments = Array.isArray(candidate.environments) ? candidate.environments : [];
  const out: DesktopProviderEnvironment[] = [];
  for (const environment of environments) {
    const normalized = normalizeDesktopProviderEnvironment(environment, options);
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}
