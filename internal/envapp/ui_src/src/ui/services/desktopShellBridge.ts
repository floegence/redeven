export interface DesktopShellBridge {
  openConnectToRedeven: () => Promise<void>;
  openDesktopSettings: () => Promise<void>;
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
    || typeof candidate.openConnectToRedeven !== 'function'
    || typeof candidate.openDesktopSettings !== 'function'
  ) {
    return null;
  }

  return candidate;
}

export function desktopShellBridgeAvailable(): boolean {
  return desktopShellBridge() !== null;
}

export async function openDesktopConnectToRedeven(): Promise<boolean> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return false;
  }

  await bridge.openConnectToRedeven();
  return true;
}

export async function openDesktopSettings(): Promise<boolean> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return false;
  }

  await bridge.openDesktopSettings();
  return true;
}
