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
import {
  DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  normalizeDesktopShellOpenExternalURLResponse,
} from '../shared/desktopShellExternalURLIPC';

export function bootstrapDesktopShellBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopShell', {
    openConnectionCenter: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    openAdvancedSettings: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'settings' });
    },
    openWindow: async (kind: unknown): Promise<void> => {
      const normalized = normalizeDesktopShellWindowKind(kind);
      if (!normalized) {
        return;
      }
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: normalized });
    },
    openExternalURL: async (url: string) => normalizeDesktopShellOpenExternalURLResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL, { url }),
    ),
    restartManagedRuntime: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'restart_managed_runtime' }),
    ),
    manageDesktopUpdate: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'manage_desktop_update' }),
    ),
  });
}
