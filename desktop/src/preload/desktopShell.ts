/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellWindowKind,
} from '../shared/desktopShellWindowIPC';
import {
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeActionResponse,
} from '../shared/desktopShellRuntimeIPC';

export function bootstrapDesktopShellBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopShell', {
    openDeviceChooser: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    switchDevice: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    openConnectionCenter: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    openAdvancedSettings: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'settings' });
    },
    openConnectToRedeven: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    openDesktopSettings: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'settings' });
    },
    openWindow: async (kind: unknown): Promise<void> => {
      const normalized = normalizeDesktopShellWindowKind(kind);
      if (!normalized) {
        return;
      }
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: normalized });
    },
    restartManagedRuntime: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'restart_managed_runtime' }),
    ),
  });
}
