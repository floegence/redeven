/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellWindowKind,
} from '../shared/desktopShellWindowIPC';

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
  });
}
