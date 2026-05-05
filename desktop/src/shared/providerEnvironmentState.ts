export type DesktopProviderEnvironmentAvailability = 'online' | 'offline' | 'unknown';
export type DesktopProviderCatalogFreshness = 'fresh' | 'stale' | 'unknown';
export type DesktopLocalRouteState = 'ready' | 'opening' | 'open' | 'unavailable';
export type DesktopControlPlaneSyncState =
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'auth_required'
  | 'provider_unreachable'
  | 'provider_invalid'
  | 'sync_error';
export type DesktopProviderRemoteRouteState =
  | 'ready'
  | 'offline'
  | 'unknown'
  | 'stale'
  | 'removed'
  | 'auth_required'
  | 'provider_unreachable'
  | 'provider_invalid';

export const DESKTOP_PROVIDER_CATALOG_STALE_AFTER_MS = 30_000;

type DesktopProviderCatalogFreshnessOptions = Readonly<{
  now?: number;
  staleAfterMS?: number;
}>;

export type DesktopProviderRemoteRouteStateOptions = Readonly<{
  syncState: DesktopControlPlaneSyncState;
  environmentPresent: boolean;
  providerRuntimeStatus?: string | null;
  providerStatus?: string | null;
  providerLifecycleStatus?: string | null;
  lastSyncedAtMS?: number;
  now?: number;
  staleAfterMS?: number;
}>;

type DesktopProviderEnvironmentRuntimeLike = Readonly<{
  runtime_health?: Readonly<{
    runtime_status?: string | null;
  }> | null;
  status?: string | null;
  lifecycle_status?: string | null;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedRuntimeState(value: unknown): string {
  return compact(value).toLowerCase();
}

function normalizeUnixMS(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

export function desktopProviderEnvironmentAvailability(
  runtimeStatus: string | null | undefined,
  status: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): DesktopProviderEnvironmentAvailability {
  const cleanRuntimeStatus = normalizedRuntimeState(runtimeStatus);
  const cleanStatus = normalizedRuntimeState(status);
  const cleanLifecycleStatus = normalizedRuntimeState(lifecycleStatus);

  if (cleanRuntimeStatus === 'offline') {
    return 'offline';
  }
  if (cleanRuntimeStatus === 'online') {
    return 'online';
  }

  if (
    cleanStatus === 'offline'
    || cleanLifecycleStatus === 'offline'
    || cleanLifecycleStatus === 'inactive'
    || cleanLifecycleStatus === 'stopped'
    || cleanLifecycleStatus === 'suspended'
  ) {
    return 'offline';
  }

  if (
    cleanStatus === 'online'
    || cleanStatus === 'ready'
    || cleanLifecycleStatus === 'active'
    || cleanLifecycleStatus === 'ready'
  ) {
    return 'online';
  }

  return 'unknown';
}

export function desktopProviderOnlineEnvironmentCount(
  environments: readonly DesktopProviderEnvironmentRuntimeLike[],
): number {
  return environments.filter((environment) => (
    desktopProviderEnvironmentAvailability(
      environment.runtime_health?.runtime_status,
      environment.status,
      environment.lifecycle_status,
    ) === 'online'
  )).length;
}

export function desktopProviderCatalogFreshness(
  lastSyncedAtMS: number | null | undefined,
  options: DesktopProviderCatalogFreshnessOptions = {},
): DesktopProviderCatalogFreshness {
  const normalizedLastSyncedAtMS = normalizeUnixMS(lastSyncedAtMS);
  if (normalizedLastSyncedAtMS <= 0) {
    return 'unknown';
  }

  const now = normalizeUnixMS(options.now) || Date.now();
  const staleAfterMS = normalizeUnixMS(options.staleAfterMS) || DESKTOP_PROVIDER_CATALOG_STALE_AFTER_MS;
  return now - normalizedLastSyncedAtMS <= staleAfterMS ? 'fresh' : 'stale';
}

export function desktopProviderRemoteRouteState(
  options: DesktopProviderRemoteRouteStateOptions,
): DesktopProviderRemoteRouteState {
  if (options.syncState === 'auth_required') {
    return 'auth_required';
  }
  if (options.syncState === 'provider_unreachable' || options.syncState === 'sync_error') {
    return 'provider_unreachable';
  }
  if (options.syncState === 'provider_invalid') {
    return 'provider_invalid';
  }

  const freshness = desktopProviderCatalogFreshness(options.lastSyncedAtMS, {
    now: options.now,
    staleAfterMS: options.staleAfterMS,
  });
  if (freshness === 'unknown') {
    return 'unknown';
  }
  if (freshness === 'stale') {
    return 'stale';
  }
  if (!options.environmentPresent) {
    return 'removed';
  }

  const availability = desktopProviderEnvironmentAvailability(
    options.providerRuntimeStatus,
    options.providerStatus,
    options.providerLifecycleStatus,
  );
  if (availability === 'online') {
    return 'ready';
  }
  if (availability === 'offline') {
    return 'offline';
  }
  return 'unknown';
}

export function desktopProviderEnvironmentRuntimeLabel(
  status: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): string {
  const cleanStatus = compact(status);
  const cleanLifecycleStatus = compact(lifecycleStatus);
  if (cleanStatus !== '' && cleanLifecycleStatus !== '') {
    return `${cleanStatus} · ${cleanLifecycleStatus}`;
  }
  return cleanStatus || cleanLifecycleStatus || 'Unknown';
}
