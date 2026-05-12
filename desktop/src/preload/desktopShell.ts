/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellWindowKind,
} from '../shared/desktopShellWindowIPC';
import {
  DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL,
  normalizeDesktopShellWindowCommand,
  normalizeDesktopShellWindowCommandResponse,
} from '../shared/desktopShellWindowCommandIPC';
import {
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeActionResponse,
} from '../shared/desktopShellRuntimeIPC';
import {
  DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL,
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
    performWindowCommand: async (command: unknown) => {
      const normalized = normalizeDesktopShellWindowCommand(command);
      if (!normalized) {
        return normalizeDesktopShellWindowCommandResponse(null);
      }
      return normalizeDesktopShellWindowCommandResponse(
        await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: normalized }),
      );
    },
    minimizeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'minimize' }),
    ),
    closeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'close' }),
    ),
    toggleMaximizeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'toggle_maximize' }),
    ),
    toggleFullScreenWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'toggle_full_screen' }),
    ),
    openExternalURL: async (url: string) => normalizeDesktopShellOpenExternalURLResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL, { url }),
    ),
    openDashboard: async () => normalizeDesktopShellOpenExternalURLResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL),
    ),
    restartManagedRuntime: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'restart_managed_runtime' }),
    ),
    manageDesktopUpdate: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'manage_desktop_update' }),
    ),
  });
}
