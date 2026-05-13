import {
  normalizeDesktopShellWindowCommandResponse,
  type DesktopShellWindowCommandResponse,
} from '../../../../../../desktop/src/shared/desktopShellWindowCommandIPC';
import {
  desktopShellRuntimeMaintenanceMethodUsesDesktop,
  normalizeDesktopShellRuntimeActionResponse,
  normalizeDesktopShellRuntimeMaintenanceContext,
  type DesktopShellRuntimeActionResponse,
  type DesktopShellRuntimeMaintenanceContext,
  type DesktopShellRuntimeMaintenanceMethod,
} from '../../../../../../desktop/src/shared/desktopShellRuntimeIPC';

export type DesktopShellExternalURLOpenResult = Readonly<{
  ok: boolean;
  message?: string;
}>;

export type DesktopManagedRuntimeRestartResult = Readonly<{
  ok: boolean;
  started: boolean;
  message?: string;
}>;

export type RuntimeMaintenanceContext = DesktopShellRuntimeMaintenanceContext;

export interface DesktopShellBridge {
  openConnectionCenter?: () => Promise<void>;
  openAdvancedSettings?: () => Promise<void>;
  openWindow?: (kind: unknown) => Promise<void>;
  performWindowCommand?: (command: unknown) => Promise<DesktopShellWindowCommandResponse>;
  minimizeWindow?: () => Promise<DesktopShellWindowCommandResponse>;
  closeWindow?: () => Promise<DesktopShellWindowCommandResponse>;
  toggleMaximizeWindow?: () => Promise<DesktopShellWindowCommandResponse>;
  toggleFullScreenWindow?: () => Promise<DesktopShellWindowCommandResponse>;
  openExternalURL?: (url: string) => Promise<DesktopShellExternalURLOpenResult>;
  openDashboard?: () => Promise<DesktopShellExternalURLOpenResult>;
  getRuntimeMaintenanceContext?: () => Promise<DesktopShellRuntimeMaintenanceContext>;
  performRuntimeMaintenanceAction?: (request: unknown) => Promise<DesktopManagedRuntimeRestartResult>;
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
      && typeof candidate.performWindowCommand !== 'function'
      && typeof candidate.minimizeWindow !== 'function'
      && typeof candidate.closeWindow !== 'function'
      && typeof candidate.toggleMaximizeWindow !== 'function'
      && typeof candidate.toggleFullScreenWindow !== 'function'
      && typeof candidate.openExternalURL !== 'function'
      && typeof candidate.openDashboard !== 'function'
      && typeof candidate.getRuntimeMaintenanceContext !== 'function'
      && typeof candidate.performRuntimeMaintenanceAction !== 'function'
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

export async function minimizeDesktopWindow(): Promise<DesktopShellWindowCommandResponse | null> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return null;
  }

  if (typeof bridge.minimizeWindow === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.minimizeWindow());
  }
  if (typeof bridge.performWindowCommand === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.performWindowCommand('minimize'));
  }
  return null;
}

export async function closeDesktopWindow(): Promise<DesktopShellWindowCommandResponse | null> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return null;
  }

  if (typeof bridge.closeWindow === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.closeWindow());
  }
  if (typeof bridge.performWindowCommand === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.performWindowCommand('close'));
  }
  return null;
}

export async function toggleDesktopWindowMaximize(): Promise<DesktopShellWindowCommandResponse | null> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return null;
  }

  if (typeof bridge.toggleMaximizeWindow === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.toggleMaximizeWindow());
  }
  if (typeof bridge.performWindowCommand === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.performWindowCommand('toggle_maximize'));
  }
  return null;
}

export async function toggleDesktopWindowFullScreen(): Promise<DesktopShellWindowCommandResponse | null> {
  const bridge = desktopShellBridge();
  if (!bridge) {
    return null;
  }

  if (typeof bridge.toggleFullScreenWindow === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.toggleFullScreenWindow());
  }
  if (typeof bridge.performWindowCommand === 'function') {
    return normalizeDesktopShellWindowCommandResponse(await bridge.performWindowCommand('toggle_full_screen'));
  }
  return null;
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

export async function openDashboardInDesktopShell(): Promise<DesktopShellExternalURLOpenResult | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.openDashboard !== 'function') {
    return null;
  }
  return bridge.openDashboard();
}

export async function getRuntimeMaintenanceContextFromDesktopShell(): Promise<DesktopShellRuntimeMaintenanceContext | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.getRuntimeMaintenanceContext !== 'function') {
    return null;
  }
  return normalizeDesktopShellRuntimeMaintenanceContext(await bridge.getRuntimeMaintenanceContext());
}

export async function performRuntimeMaintenanceActionInDesktopShell(
  request: Readonly<{ action: 'restart' | 'upgrade'; target_version?: string }>,
): Promise<DesktopShellRuntimeActionResponse | null> {
  const bridge = desktopShellBridge();
  if (!bridge || typeof bridge.performRuntimeMaintenanceAction !== 'function') {
    return null;
  }
  return normalizeDesktopShellRuntimeActionResponse(await bridge.performRuntimeMaintenanceAction(request));
}

export function runtimeMaintenanceMethodUsesDesktop(method: DesktopShellRuntimeMaintenanceMethod): boolean {
  return desktopShellRuntimeMaintenanceMethodUsesDesktop(method);
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
