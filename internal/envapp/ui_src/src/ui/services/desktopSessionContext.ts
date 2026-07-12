import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopSessionContextSnapshot {
  local_environment_id: string;
  renderer_storage_scope_id: string;
  target_kind?: 'local_environment' | 'external_local_ui' | 'ssh_environment' | 'gateway_environment';
  target_route?: 'local_host' | 'remote_desktop';
  session_source?: 'local_runtime' | 'provider_environment' | 'ssh_environment' | 'external_local_ui' | 'runtime_gateway';
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  label?: string;
}

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
  notifyAppReady?: (payload: {
    state: 'access_gate_interactive' | 'runtime_connected';
    timings?: Readonly<{
      bootstrap_ms?: number;
      access_ready_ms?: number;
      protocol_connected_ms?: number;
      shell_painted_ms?: number;
    }>;
  }) => void;
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
  const targetKind = compact(candidate.target_kind);
  const targetRoute = compact(candidate.target_route);
  const sessionSource = compact(candidate.session_source);
  const providerOrigin = compact(candidate.provider_origin);
  const providerID = compact(candidate.provider_id);
  const envPublicID = compact(candidate.env_public_id);
  const label = compact(candidate.label);
  if (localEnvironmentID === '' || rendererStorageScopeID === '') {
    return null;
  }
  return {
    local_environment_id: localEnvironmentID,
    renderer_storage_scope_id: rendererStorageScopeID,
    ...(targetKind === 'local_environment' || targetKind === 'external_local_ui' || targetKind === 'ssh_environment' || targetKind === 'gateway_environment' ? { target_kind: targetKind } : {}),
    ...(targetRoute === 'local_host' || targetRoute === 'remote_desktop' ? { target_route: targetRoute } : {}),
    ...(sessionSource === 'local_runtime' || sessionSource === 'provider_environment' || sessionSource === 'ssh_environment' || sessionSource === 'external_local_ui' || sessionSource === 'runtime_gateway' ? { session_source: sessionSource } : {}),
    ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
    ...(providerID !== '' ? { provider_id: providerID } : {}),
    ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
    ...(label !== '' ? { label } : {}),
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

export function notifyDesktopSessionAppReady(
  state: 'access_gate_interactive' | 'runtime_connected',
  timings?: Readonly<{
    bootstrap_ms?: number;
    access_ready_ms?: number;
    protocol_connected_ms?: number;
    shell_painted_ms?: number;
  }>,
): boolean {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.notifyAppReady !== 'function') {
    return false;
  }
  try {
    bridge.notifyAppReady({ state, ...(timings ? { timings } : {}) });
    return true;
  } catch {
    return false;
  }
}
