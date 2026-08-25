/// <reference lib="dom" />

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  DESKTOP_UPDATE_GET_SNAPSHOT_CHANNEL,
  DESKTOP_UPDATE_OPEN_REQUESTED_CHANNEL,
  DESKTOP_UPDATE_PERFORM_ACTION_CHANNEL,
  DESKTOP_UPDATE_SNAPSHOT_UPDATED_CHANNEL,
  normalizeDesktopUpdateAction,
  normalizeDesktopUpdateSnapshot,
  unsupportedDesktopUpdateSnapshot,
  type DesktopUpdateAction,
  type DesktopUpdateActionResponse,
  type DesktopUpdateSnapshot,
} from '../shared/desktopUpdateIPC';

declare global {
  interface Window {
    redevenDesktopUpdate?: DesktopUpdateBridge;
  }
}

export interface DesktopUpdateBridge {
  getSnapshot: () => Promise<DesktopUpdateSnapshot>;
  perform: (action: DesktopUpdateAction) => Promise<DesktopUpdateActionResponse>;
  subscribe: (listener: (snapshot: DesktopUpdateSnapshot) => void) => () => void;
  subscribeOpenRequested: (listener: () => void) => () => void;
}

export function bootstrapDesktopUpdateBridge(): void {
  const bridge: DesktopUpdateBridge = {
    getSnapshot: async () => normalizeDesktopUpdateSnapshot(
      await ipcRenderer.invoke(DESKTOP_UPDATE_GET_SNAPSHOT_CHANNEL),
    ),
    perform: async (action) => {
      const normalized = normalizeDesktopUpdateAction(action);
      if (!normalized) {
        return {
          ok: false,
          snapshot: unsupportedDesktopUpdateSnapshot(),
          message: 'Invalid Desktop update action.',
        };
      }
      return ipcRenderer.invoke(DESKTOP_UPDATE_PERFORM_ACTION_CHANNEL, normalized);
    },
    subscribe: (listener) => {
      if (typeof listener !== 'function') return () => undefined;
      const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
        listener(normalizeDesktopUpdateSnapshot(value));
      };
      ipcRenderer.on(DESKTOP_UPDATE_SNAPSHOT_UPDATED_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(DESKTOP_UPDATE_SNAPSHOT_UPDATED_CHANNEL, wrapped);
    },
    subscribeOpenRequested: (listener) => {
      if (typeof listener !== 'function') return () => undefined;
      const wrapped = (): void => listener();
      ipcRenderer.on(DESKTOP_UPDATE_OPEN_REQUESTED_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(DESKTOP_UPDATE_OPEN_REQUESTED_CHANNEL, wrapped);
    },
  };
  contextBridge.exposeInMainWorld('redevenDesktopUpdate', bridge);
}
