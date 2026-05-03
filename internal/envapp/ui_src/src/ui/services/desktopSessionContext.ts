import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopSessionContextSnapshot {
  managed_environment_id: string;
  environment_storage_scope_id: string;
}

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
  notifyAppReady?: (payload: { state: 'access_gate_interactive' | 'runtime_connected' }) => void;
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

function isDesktopSessionContextBridge(candidate: unknown): candidate is DesktopSessionContextBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopSessionContextBridge>;
  return typeof bridge.getSnapshot === 'function';
}

export function readDesktopSessionContextSnapshot(): DesktopSessionContextSnapshot | null {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge) {
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

export function notifyDesktopSessionAppReady(state: 'access_gate_interactive' | 'runtime_connected'): boolean {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.notifyAppReady !== 'function') {
    return false;
  }
  try {
    bridge.notifyAppReady({ state });
    return true;
  } catch {
    return false;
  }
}
