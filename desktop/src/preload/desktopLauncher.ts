/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  type DesktopLauncherActionRequest,
  type DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';

export function bootstrapDesktopLauncherBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopLauncher', {
    getSnapshot: (): Promise<DesktopWelcomeSnapshot> => ipcRenderer.invoke(DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL),
    performAction: (request: DesktopLauncherActionRequest): Promise<void> =>
      ipcRenderer.invoke(DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL, request),
  });
}

