import type {
  DesktopControlPlaneSyncState,
  DesktopProviderCatalogFreshness,
} from './providerEnvironmentState';

export type DesktopCloudProtocolVersion = 'rcpp-v4';

export type DesktopCloudAccessPoint = Readonly<{
  access_point_id: string;
  region: string;
  display_name: string;
  description: string;
  access_point_origin: string;
  country_code: string;
  city: string;
  status: string;
  health_status: string;
}>;

export type DesktopCloud = Readonly<{
  protocol_version: DesktopCloudProtocolVersion;
  cloud_id: string;
  display_name: string;
  cloud_origin: string;
  documentation_url: string;
  access_points: readonly DesktopCloudAccessPoint[];
}>;

export type DesktopControlPlaneAccount = Readonly<{
  cloud_id: string;
  cloud_origin: string;
  display_name: string;
  user_public_id: string;
  user_display_name: string;
  authorization_expires_at_unix_ms: number;
}>;

export type DesktopCloudRuntimeStatus = 'online' | 'offline';

export type DesktopCloudEnvironmentAccess = Readonly<{
  can_connect: boolean;
  workspace_read: boolean;
  workspace_write: boolean;
  workspace_execute: boolean;
}>;

export type DesktopCloudEnvironmentRuntimeHealth = Readonly<{
  env_public_id: string;
  runtime_status: DesktopCloudRuntimeStatus;
  observed_at_unix_ms: number;
  last_seen_at_unix_ms: number;
  offline_reason_code: string;
  offline_reason: string;
}>;

export type DesktopCloudEnvironment = Readonly<{
  cloud_id: string;
  cloud_origin: string;
  env_public_id: string;
  region: string;
  access_point_id: string;
  access_point_origin: string;
  label: string;
  environment_url?: string;
  description: string;
  namespace_public_id: string;
  namespace_name: string;
  status: string;
  lifecycle_status: string;
  last_seen_at_unix_ms: number;
  runtime_health?: DesktopCloudEnvironmentRuntimeHealth;
  access?: DesktopCloudEnvironmentAccess;
}>;

export type DesktopControlPlaneSummary = Readonly<{
  cloud: DesktopCloud;
  account: DesktopControlPlaneAccount;
  environments: readonly DesktopCloudEnvironment[];
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

export function defaultControlPlaneDisplayLabel(cloudOrigin: string): string {
  const suggested = suggestControlPlaneDisplayLabel(normalizeControlPlaneOrigin(cloudOrigin));
  return suggested === '' ? normalizeControlPlaneOrigin(cloudOrigin) : suggested;
}

export function normalizeControlPlaneDisplayLabel(value: unknown, cloudOrigin: string): string {
  const clean = compact(value);
  return clean === '' ? defaultControlPlaneDisplayLabel(cloudOrigin) : clean;
}

export function normalizeControlPlaneOrigin(rawURL: string): string {
  const clean = compact(rawURL);
  if (clean === '') {
    throw new Error('Provider URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('Provider URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Provider URL must start with http:// or https://.');
  }
  if (compact(parsed.hostname) === '') {
    throw new Error('Provider URL must include a host.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Provider URL must not include embedded credentials.');
  }

  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

export function desktopControlPlaneKey(cloudOrigin: string, cloudID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(cloudOrigin);
  const normalizedProviderID = compact(cloudID);
  if (normalizedProviderID === '') {
    throw new Error('Provider ID is required.');
  }
  return `${normalizedOrigin}|${normalizedProviderID}`;
}

function normalizeCloudProtocolVersion(value: unknown): DesktopCloudProtocolVersion | null {
  return compact(value) === 'rcpp-v4' ? 'rcpp-v4' : null;
}

function normalizeUnixMS(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function normalizeEnvironmentURL(value: unknown): string {
  const clean = compact(value);
  if (clean === '') {
    return '';
  }
  try {
    const parsed = new URL(clean);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || compact(parsed.host) === '') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeCloudRuntimeStatus(value: unknown): DesktopCloudRuntimeStatus | null {
  const clean = compact(value).toLowerCase();
  return clean === 'online' || clean === 'offline' ? clean : null;
}

export function normalizeDesktopCloudEnvironmentAccess(value: unknown): DesktopCloudEnvironmentAccess | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return {
    can_connect: candidate.can_connect === true,
    workspace_read: candidate.workspace_read === true,
    workspace_write: candidate.workspace_write === true,
    workspace_execute: candidate.workspace_execute === true,
  };
}

export function normalizeDesktopCloudEnvironmentRuntimeHealth(
  value: unknown,
): DesktopCloudEnvironmentRuntimeHealth | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const envPublicID = compact(candidate.env_public_id);
  const runtimeStatus = normalizeCloudRuntimeStatus(candidate.runtime_status);
  const observedAtUnixMS = normalizeUnixMS(candidate.observed_at_unix_ms);
  if (envPublicID === '' || !runtimeStatus || observedAtUnixMS <= 0) {
    return null;
  }

  return {
    env_public_id: envPublicID,
    runtime_status: runtimeStatus,
    observed_at_unix_ms: observedAtUnixMS,
    last_seen_at_unix_ms: normalizeUnixMS(candidate.last_seen_at_unix_ms),
    offline_reason_code: compact(candidate.offline_reason_code),
    offline_reason: compact(candidate.offline_reason),
  };
}

export function normalizeDesktopCloudEnvironmentRuntimeHealthList(
  value: unknown,
): readonly DesktopCloudEnvironmentRuntimeHealth[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const environments = Array.isArray(candidate.environments) ? candidate.environments : [];
  const out: DesktopCloudEnvironmentRuntimeHealth[] = [];
  for (const environment of environments) {
    const normalized = normalizeDesktopCloudEnvironmentRuntimeHealth(environment);
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}

export function normalizeDesktopCloudAccessPoint(value: unknown): DesktopCloudAccessPoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const accessPointID = compact(candidate.access_point_id);
  const region = compact(candidate.region);
  const displayName = compact(candidate.display_name);
  const status = compact(candidate.status);
  let accessPointOrigin = '';
  try {
    accessPointOrigin = normalizeControlPlaneOrigin(compact(candidate.access_point_origin));
  } catch {
    return null;
  }
  if (
    accessPointID === ''
    || region === ''
    || displayName === ''
    || status === ''
    || accessPointOrigin === ''
  ) {
    return null;
  }

  return {
    access_point_id: accessPointID,
    region,
    display_name: displayName,
    description: compact(candidate.description),
    access_point_origin: accessPointOrigin,
    country_code: compact(candidate.country_code),
    city: compact(candidate.city),
    status,
    health_status: compact(candidate.health_status),
  };
}

export function normalizeDesktopCloudAccessPointList(value: unknown): readonly DesktopCloudAccessPoint[] {
  const source = Array.isArray(value) ? value : [];
  const out: DesktopCloudAccessPoint[] = [];
  const seenIDs = new Set<string>();
  for (const item of source) {
    const accessPoint = normalizeDesktopCloudAccessPoint(item);
    if (!accessPoint || seenIDs.has(accessPoint.access_point_id)) {
      continue;
    }
    seenIDs.add(accessPoint.access_point_id);
    out.push(accessPoint);
  }
  return out;
}

export function normalizeDesktopCloud(value: unknown): DesktopCloud | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const protocolVersion = normalizeCloudProtocolVersion(candidate.protocol_version);
  if (!protocolVersion) {
    return null;
  }

  const cloudID = compact(candidate.cloud_id);
  const displayName = compact(candidate.display_name);
  const documentationURL = compact(candidate.documentation_url);
  const accessPoints = normalizeDesktopCloudAccessPointList(candidate.access_points);
  if (cloudID === '' || displayName === '' || documentationURL === '' || accessPoints.length === 0) {
    return null;
  }

  let cloudOrigin = '';
  try {
    cloudOrigin = normalizeControlPlaneOrigin(compact(candidate.cloud_origin));
  } catch {
    return null;
  }

  return {
    protocol_version: protocolVersion,
    cloud_id: cloudID,
    display_name: displayName,
    cloud_origin: cloudOrigin,
    documentation_url: documentationURL,
    access_points: accessPoints,
  };
}

type NormalizeDesktopControlPlaneAccountOptions = Readonly<{
  cloud: DesktopCloud;
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
    cloud_id: options.cloud.cloud_id,
    cloud_origin: options.cloud.cloud_origin,
    display_name: options.cloud.display_name,
    user_public_id: userPublicID,
    user_display_name: userDisplayName,
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
  };
}

type NormalizeDesktopCloudEnvironmentOptions = Readonly<{
  cloud: DesktopCloud;
}>;

export function normalizeDesktopCloudEnvironment(
  value: unknown,
  options: NormalizeDesktopCloudEnvironmentOptions,
): DesktopCloudEnvironment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const envPublicID = compact(candidate.env_public_id);
  const region = compact(candidate.region);
  const accessPointID = compact(candidate.access_point_id);
  const label = compact(candidate.name);
  const environmentURL = normalizeEnvironmentURL(candidate.environment_url);
  let accessPointOrigin = '';
  try {
    accessPointOrigin = normalizeControlPlaneOrigin(compact(candidate.access_point_origin));
  } catch {
    return null;
  }
  if (
    envPublicID === ''
    || region === ''
    || accessPointID === ''
    || accessPointOrigin === ''
    || label === ''
  ) {
    return null;
  }

  return {
    cloud_id: options.cloud.cloud_id,
    cloud_origin: options.cloud.cloud_origin,
    env_public_id: envPublicID,
    region,
    access_point_id: accessPointID,
    access_point_origin: accessPointOrigin,
    label,
    environment_url: environmentURL || undefined,
    description: compact(candidate.description),
    namespace_public_id: compact(candidate.namespace_public_id),
    namespace_name: compact(candidate.namespace_name),
    status: compact(candidate.status),
    lifecycle_status: compact(candidate.lifecycle_status),
    last_seen_at_unix_ms: normalizeUnixMS(candidate.last_seen_at_unix_ms),
    runtime_health: normalizeDesktopCloudEnvironmentRuntimeHealth(candidate.runtime_health) ?? undefined,
    access: normalizeDesktopCloudEnvironmentAccess(candidate.access) ?? undefined,
  };
}

export function normalizeDesktopCloudEnvironmentList(
  value: unknown,
  options: NormalizeDesktopCloudEnvironmentOptions,
): readonly DesktopCloudEnvironment[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const environments = Array.isArray(candidate.environments) ? candidate.environments : [];
  const out: DesktopCloudEnvironment[] = [];
  for (const environment of environments) {
    const normalized = normalizeDesktopCloudEnvironment(environment, options);
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}
