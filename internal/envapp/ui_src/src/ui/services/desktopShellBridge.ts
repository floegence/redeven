export type DesktopShellExternalURLOpenResult = Readonly<{
  ok: boolean;
  message?: string;
}>;

export type DesktopManagedRuntimeRestartResult = Readonly<{
  ok: boolean;
  started: boolean;
  message?: string;
}>;

export interface DesktopShellBridge {
  openConnectionCenter?: () => Promise<void>;
  openAdvancedSettings?: () => Promise<void>;
  openWindow?: (kind: unknown) => Promise<void>;
  openExternalURL?: (url: string) => Promise<DesktopShellExternalURLOpenResult>;
  restartManagedRuntime?: () => Promise<DesktopManagedRuntimeRestartResult>;
  manageDesktopUpdate?: () => Promise<DesktopManagedRuntimeRestartResult>;
}

declare global {
  interface Window {
    redevenDesktopShell?: DesktopShellBridge;
  }
}

function desktopShellBridge(): DesktopShellBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const candidate = window.redevenDesktopShell;
  if (
    !candidate
    || (
      typeof candidate.openConnectionCenter !== 'function'
      && typeof candidate.openAdvancedSettings !== 'function'
      && typeof candidate.openWindow !== 'function'
      && typeof candidate.openExternalURL !== 'function'
      && typeof candidate.restartManagedRuntime !== 'function'
      && typeof candidate.manageDesktopUpdate !== 'function'
    )
  ) {
    return null;
  }

  return candidate;
}

export function desktopShellBridgeAvailable(): boolean {
  return desktopShellBridge() !== null;
}

export async function openConnectionCenter(): Promise<boolean> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return false;
  }

  if (typeof bridge.openConnectionCenter === 'function') {
    await bridge.openConnectionCenter();
    return true;
  }
  if (typeof bridge.openWindow === 'function') {
    await bridge.openWindow('connection_center');
    return true;
  }
  return false;
}

export async function openAdvancedSettings(): Promise<boolean> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return false;
  }

  if (typeof bridge.openAdvancedSettings === 'function') {
    await bridge.openAdvancedSettings();
    return true;
  }
  if (typeof bridge.openWindow === 'function') {
    await bridge.openWindow('settings');
    return true;
  }
  return openConnectionCenter();
}

export function desktopShellExternalURLOpenAvailable(): boolean {
  const bridge = desktopShellBridge();
  return Boolean(bridge && typeof bridge.openExternalURL === 'function');
}

export async function openExternalURLInDesktopShell(url: string): Promise<DesktopShellExternalURLOpenResult | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.openExternalURL !== 'function') {
    return null;
  }
  return bridge.openExternalURL(url);
}

export async function restartDesktopManagedRuntime(): Promise<DesktopManagedRuntimeRestartResult | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.restartManagedRuntime !== 'function') {
    return null;
  }
  return bridge.restartManagedRuntime();
}

export async function manageDesktopUpdate(): Promise<DesktopManagedRuntimeRestartResult | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.manageDesktopUpdate !== 'function') {
    return null;
  }
  return bridge.manageDesktopUpdate();
}
