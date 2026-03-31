export interface DesktopShellBridge {
  openDeviceChooser?: () => Promise<void>;
  switchDevice?: () => Promise<void>;
  openConnectionCenter?: () => Promise<void>;
  openAdvancedSettings?: () => Promise<void>;
  openConnectToRedeven?: () => Promise<void>;
  openDesktopSettings?: () => Promise<void>;
  openWindow?: (kind: unknown) => Promise<void>;
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
      typeof candidate.openDeviceChooser !== 'function'
      && typeof candidate.switchDevice !== 'function'
      && typeof candidate.openConnectionCenter !== 'function'
      && typeof candidate.openConnectToRedeven !== 'function'
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

  if (typeof bridge.openDeviceChooser === 'function') {
    await bridge.openDeviceChooser();
    return true;
  }
  if (typeof bridge.switchDevice === 'function') {
    await bridge.switchDevice();
    return true;
  }
  if (typeof bridge.openConnectionCenter === 'function') {
    await bridge.openConnectionCenter();
    return true;
  }
  await bridge.openConnectToRedeven?.();
  return true;
}

export async function openAdvancedSettings(): Promise<boolean> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return false;
  }

  if (typeof bridge.openAdvancedSettings !== 'function' && typeof bridge.openDesktopSettings !== 'function') {
    return openConnectionCenter();
  }
  if (typeof bridge.openAdvancedSettings === 'function') {
    await bridge.openAdvancedSettings();
    return true;
  }
  await bridge.openDesktopSettings?.();
  return true;
}

export async function openDesktopConnectToRedeven(): Promise<boolean> {
  return openConnectionCenter();
}

export async function openDesktopSettings(): Promise<boolean> {
  return openAdvancedSettings();
}
