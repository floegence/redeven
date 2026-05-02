/// <reference lib="dom" />

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL,
  DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL,
  type DesktopLauncherActionProgress,
  type DesktopLauncherActionResult,
  type DesktopLauncherActionRequest,
  type DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import {
  DESKTOP_LAUNCHER_GET_SSH_CONFIG_HOSTS_CHANNEL,
  normalizeDesktopSSHConfigHosts,
  type DesktopSSHConfigHost,
} from '../shared/desktopSSHConfig';

export function bootstrapDesktopLauncherBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopLauncher', {
    getSnapshot: (): Promise<DesktopWelcomeSnapshot> => ipcRenderer.invoke(DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL),
    getSSHConfigHosts: async (): Promise<readonly DesktopSSHConfigHost[]> => (
      normalizeDesktopSSHConfigHosts(await ipcRenderer.invoke(DESKTOP_LAUNCHER_GET_SSH_CONFIG_HOSTS_CHANNEL))
    ),
    performAction: (request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> =>
      ipcRenderer.invoke(DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL, request),
    subscribeActionProgress: (listener: (progress: DesktopLauncherActionProgress) => void): (() => void) => {
      if (typeof listener !== 'function') {
        return () => undefined;
      }
      const wrappedListener = (_event: IpcRendererEvent, progress: DesktopLauncherActionProgress) => {
        listener(progress);
      };
      ipcRenderer.on(DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL, wrappedListener);
      };
    },
    subscribeSnapshot: (listener: (snapshot: DesktopWelcomeSnapshot) => void): (() => void) => {
      if (typeof listener !== 'function') {
        return () => undefined;
      }
      const wrappedListener = (_event: IpcRendererEvent, snapshot: DesktopWelcomeSnapshot) => {
        listener(snapshot);
      };
      ipcRenderer.on(DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL, wrappedListener);
      };
    },
  });
}
