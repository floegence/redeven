import type {
  DesktopControlPlaneSyncState,
  DesktopProviderCatalogFreshness,
} from './providerEnvironmentState';

export type DesktopProviderProtocolVersion = 'rcpp-v3';

export type DesktopProviderAccessPoint = Readonly<{
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

export type DesktopControlPlaneProvider = Readonly<{
  protocol_version: DesktopProviderProtocolVersion;
  provider_id: string;
  display_name: string;
  provider_origin: string;
  documentation_url: string;
  access_points: readonly DesktopProviderAccessPoint[];
}>;

export type DesktopControlPlaneAccount = Readonly<{
  provider_id: string;
  provider_origin: string;
  display_name: string;
  user_public_id: string;
  user_display_name: string;
  authorization_expires_at_unix_ms: number;
}>;

export type DesktopProviderRuntimeStatus = 'online' | 'offline';

export type DesktopProviderRuntimeGrant = 'manage_runtime' | 'deploy_custom_runtime' | 'manage_runtime_binding';
export type DesktopProviderRuntimeManagementSupport = 'supported' | 'unsupported' | 'unknown';
export type DesktopProviderRuntimeManagementAuthorizationState = 'allowed' | 'denied' | 'unknown';
export type DesktopProviderRuntimeManagementReadiness = 'ready' | 'setup_required' | 'temporarily_unavailable' | 'unknown';
export type DesktopProviderRuntimeManagementPresentationState = 'allowed' | 'denied' | 'setup_required' | 'temporarily_unavailable' | 'unsupported' | 'unknown';

export type DesktopProviderEnvironmentAccess = Readonly<{
  can_connect: boolean;
  workspace_read: boolean;
  workspace_write: boolean;
  workspace_execute: boolean;
}>;

export type DesktopProviderRuntimeManagementCapability = Readonly<{
  support: DesktopProviderRuntimeManagementSupport;
  authorization: Readonly<{
    state: DesktopProviderRuntimeManagementAuthorizationState;
    grants: readonly DesktopProviderRuntimeGrant[];
  }>;
  readiness: DesktopProviderRuntimeManagementReadiness;
  presentation_state: DesktopProviderRuntimeManagementPresentationState;
  target?: Readonly<{
    lifecycle_target_id: string;
    target_generation: number;
  }>;
  operations: readonly ('start' | 'stop' | 'restart' | 'update_runtime' | 'reconcile')[];
  artifact_policies: readonly ('published_release' | 'custom_build')[];
  binding_actions: readonly string[];
  supervision_mode: string;
  reason_code: string;
  checked_at_unix_ms: number;
}>;

export type DesktopProviderEnvironmentRuntimeHealth = Readonly<{
  env_public_id: string;
  runtime_status: DesktopProviderRuntimeStatus;
  observed_at_unix_ms: number;
  last_seen_at_unix_ms: number;
  offline_reason_code: string;
  offline_reason: string;
}>;

export type DesktopProviderEnvironment = Readonly<{
  provider_id: string;
  provider_origin: string;
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
  runtime_health?: DesktopProviderEnvironmentRuntimeHealth;
  access?: DesktopProviderEnvironmentAccess;
  runtime_management?: DesktopProviderRuntimeManagementCapability;
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

export function desktopControlPlaneKey(providerOrigin: string, providerID: string): string {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const normalizedProviderID = compact(providerID);
  if (normalizedProviderID === '') {
    throw new Error('Provider ID is required.');
  }
  return `${normalizedOrigin}|${normalizedProviderID}`;
}

function normalizeProviderProtocolVersion(value: unknown): DesktopProviderProtocolVersion | null {
  return compact(value) === 'rcpp-v3' ? 'rcpp-v3' : null;
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

function normalizeProviderRuntimeStatus(value: unknown): DesktopProviderRuntimeStatus | null {
  const clean = compact(value).toLowerCase();
  return clean === 'online' || clean === 'offline' ? clean : null;
}

export function projectDesktopProviderRuntimeManagementState(
  support: DesktopProviderRuntimeManagementSupport,
  authorization: DesktopProviderRuntimeManagementAuthorizationState,
  readiness: DesktopProviderRuntimeManagementReadiness,
): DesktopProviderRuntimeManagementPresentationState {
  if (support === 'unsupported') return 'unsupported';
  if (support !== 'supported') return 'unknown';
  if (authorization === 'denied') return 'denied';
  if (authorization !== 'allowed') return 'unknown';
  if (readiness === 'ready') return 'allowed';
  if (readiness === 'setup_required') return 'setup_required';
  if (readiness === 'temporarily_unavailable') return 'temporarily_unavailable';
  return 'unknown';
}

function normalizeStringSet<T extends string>(value: unknown, allowed: readonly T[]): readonly T[] {
  if (!Array.isArray(value)) return [];
  const allowedValues = new Set<string>(allowed);
  return [...new Set(value.map((item) => compact(item)).filter((item): item is T => allowedValues.has(item)))].sort();
}

export function normalizeDesktopProviderEnvironmentAccess(value: unknown): DesktopProviderEnvironmentAccess | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return {
    can_connect: candidate.can_connect === true,
    workspace_read: candidate.workspace_read === true,
    workspace_write: candidate.workspace_write === true,
    workspace_execute: candidate.workspace_execute === true,
  };
}

export function normalizeDesktopProviderRuntimeManagementCapability(
  value: unknown,
): DesktopProviderRuntimeManagementCapability | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const support = compact(candidate.support) as DesktopProviderRuntimeManagementSupport;
  const readiness = compact(candidate.readiness) as DesktopProviderRuntimeManagementReadiness;
  const authorizationCandidate = candidate.authorization && typeof candidate.authorization === 'object'
    ? candidate.authorization as Record<string, unknown>
    : {};
  const authorizationState = compact(authorizationCandidate.state) as DesktopProviderRuntimeManagementAuthorizationState;
  if (!['supported', 'unsupported', 'unknown'].includes(support)
    || !['ready', 'setup_required', 'temporarily_unavailable', 'unknown'].includes(readiness)
    || !['allowed', 'denied', 'unknown'].includes(authorizationState)) {
    return null;
  }
  const disclosedReadiness = authorizationState === 'allowed' ? readiness : 'unknown';
  const presentationState = projectDesktopProviderRuntimeManagementState(support, authorizationState, disclosedReadiness);
  const grants = authorizationState === 'allowed'
    ? normalizeStringSet(authorizationCandidate.grants, ['manage_runtime', 'deploy_custom_runtime', 'manage_runtime_binding'] as const)
    : [];
  const targetCandidate = candidate.target && typeof candidate.target === 'object'
    ? candidate.target as Record<string, unknown>
    : null;
  const lifecycleTargetID = compact(targetCandidate?.lifecycle_target_id);
  const targetGeneration = Number(targetCandidate?.target_generation);
  const target = support === 'supported' && authorizationState === 'allowed'
    && lifecycleTargetID !== '' && Number.isSafeInteger(targetGeneration) && targetGeneration > 0
    ? { lifecycle_target_id: lifecycleTargetID, target_generation: targetGeneration }
    : undefined;
  const canDiscloseManagementFacts = support === 'supported' && authorizationState === 'allowed';
  return {
    support,
    authorization: { state: authorizationState, grants },
    readiness: disclosedReadiness,
    presentation_state: presentationState,
    ...(target ? { target } : {}),
    operations: canDiscloseManagementFacts
      ? normalizeStringSet(candidate.operations, ['start', 'stop', 'restart', 'update_runtime', 'reconcile'] as const)
      : [],
    artifact_policies: canDiscloseManagementFacts
      ? normalizeStringSet(candidate.artifact_policies, ['published_release', 'custom_build'] as const)
      : [],
    binding_actions: canDiscloseManagementFacts ? normalizeStringSet(candidate.binding_actions, ['enroll', 'rebind', 'rotate_supervisor_key'] as const) : [],
    supervision_mode: canDiscloseManagementFacts ? compact(candidate.supervision_mode) : '',
    reason_code: authorizationState === 'allowed'
      ? compact(candidate.reason_code)
      : authorizationState === 'denied'
        ? 'runtime_management_permission_required'
        : '',
    checked_at_unix_ms: normalizeUnixMS(candidate.checked_at_unix_ms),
  };
}

export function normalizeDesktopProviderEnvironmentRuntimeHealth(
  value: unknown,
): DesktopProviderEnvironmentRuntimeHealth | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const envPublicID = compact(candidate.env_public_id);
  const runtimeStatus = normalizeProviderRuntimeStatus(candidate.runtime_status);
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

export function normalizeDesktopProviderEnvironmentRuntimeHealthList(
  value: unknown,
): readonly DesktopProviderEnvironmentRuntimeHealth[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate = value as Record<string, unknown>;
  const environments = Array.isArray(candidate.environments) ? candidate.environments : [];
  const out: DesktopProviderEnvironmentRuntimeHealth[] = [];
  for (const environment of environments) {
    const normalized = normalizeDesktopProviderEnvironmentRuntimeHealth(environment);
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  return out;
}

export function normalizeDesktopProviderAccessPoint(value: unknown): DesktopProviderAccessPoint | null {
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

export function normalizeDesktopProviderAccessPointList(value: unknown): readonly DesktopProviderAccessPoint[] {
  const source = Array.isArray(value) ? value : [];
  const out: DesktopProviderAccessPoint[] = [];
  const seenIDs = new Set<string>();
  for (const item of source) {
    const accessPoint = normalizeDesktopProviderAccessPoint(item);
    if (!accessPoint || seenIDs.has(accessPoint.access_point_id)) {
      continue;
    }
    seenIDs.add(accessPoint.access_point_id);
    out.push(accessPoint);
  }
  return out;
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
  const accessPoints = normalizeDesktopProviderAccessPointList(candidate.access_points);
  if (providerID === '' || displayName === '' || documentationURL === '' || accessPoints.length === 0) {
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
    access_points: accessPoints,
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
    provider_id: options.provider.provider_id,
    provider_origin: options.provider.provider_origin,
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
    runtime_health: normalizeDesktopProviderEnvironmentRuntimeHealth(candidate.runtime_health) ?? undefined,
    access: normalizeDesktopProviderEnvironmentAccess(candidate.access) ?? undefined,
    runtime_management: normalizeDesktopProviderRuntimeManagementCapability(candidate.runtime_management) ?? undefined,
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
