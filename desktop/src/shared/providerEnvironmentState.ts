export type DesktopProviderEnvironmentAvailability = 'online' | 'offline' | 'unknown';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedRuntimeState(value: unknown): string {
  return compact(value).toLowerCase();
}

export function desktopProviderEnvironmentAvailability(
  status: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): DesktopProviderEnvironmentAvailability {
  const cleanStatus = normalizedRuntimeState(status);
  const cleanLifecycleStatus = normalizedRuntimeState(lifecycleStatus);

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
