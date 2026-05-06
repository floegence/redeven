import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopSessionContextSnapshot {
  local_environment_id: string;
  renderer_storage_scope_id: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
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
  const localEnvironmentID = compact(candidate.local_environment_id);
  const rendererStorageScopeID = compact(candidate.renderer_storage_scope_id);
  const providerOrigin = compact(candidate.provider_origin);
  const providerID = compact(candidate.provider_id);
  const envPublicID = compact(candidate.env_public_id);
  if (localEnvironmentID === '' || rendererStorageScopeID === '') {
    return null;
  }
  return {
    local_environment_id: localEnvironmentID,
    renderer_storage_scope_id: rendererStorageScopeID,
    ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
    ...(providerID !== '' ? { provider_id: providerID } : {}),
    ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
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

export function desktopRendererStorageScopeID(): string {
  return compact(readDesktopSessionContextSnapshot()?.renderer_storage_scope_id);
}

export function resolveRendererStorageScopeID(fallback: string): string {
  return desktopRendererStorageScopeID() || compact(fallback);
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
