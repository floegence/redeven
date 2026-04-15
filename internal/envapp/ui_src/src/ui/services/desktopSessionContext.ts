export interface DesktopSessionContextSnapshot {
  managed_environment_id: string;
  environment_storage_scope_id: string;
}

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
}

declare global {
  interface Window {
    redevenDesktopSessionContext?: DesktopSessionContextBridge;
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDesktopSessionContextSnapshot(value: unknown): DesktopSessionContextSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopSessionContextSnapshot>;
  const managedEnvironmentID = compact(candidate.managed_environment_id);
  const environmentStorageScopeID = compact(candidate.environment_storage_scope_id);
  if (managedEnvironmentID === '' || environmentStorageScopeID === '') {
    return null;
  }
  return {
    managed_environment_id: managedEnvironmentID,
    environment_storage_scope_id: environmentStorageScopeID,
  };
}

export function readDesktopSessionContextSnapshot(): DesktopSessionContextSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const bridge = window.redevenDesktopSessionContext;
  if (!bridge || typeof bridge.getSnapshot !== 'function') {
    return null;
  }
  try {
    return normalizeDesktopSessionContextSnapshot(bridge.getSnapshot());
  } catch {
    return null;
  }
}

export function desktopManagedEnvironmentStorageScopeID(): string {
  return compact(readDesktopSessionContextSnapshot()?.environment_storage_scope_id);
}

export function resolveEnvironmentStorageScopeID(fallback: string): string {
  return desktopManagedEnvironmentStorageScopeID() || compact(fallback);
}
