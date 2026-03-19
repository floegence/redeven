/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_STATE_GET_CHANNEL,
  DESKTOP_STATE_KEYS_CHANNEL,
  DESKTOP_STATE_REMOVE_CHANNEL,
  DESKTOP_STATE_SET_CHANNEL,
  normalizeDesktopStateKey,
  type DesktopStateStorageBridge,
} from '../shared/stateIPC';

export function bootstrapDesktopStateStorageBridge(): void {
  const bridge: DesktopStateStorageBridge = {
    getItem: (key) => {
      const cleanKey = normalizeDesktopStateKey(key);
      if (!cleanKey) {
        return null;
      }
      const value = ipcRenderer.sendSync(DESKTOP_STATE_GET_CHANNEL, cleanKey);
      return typeof value === 'string' ? value : null;
    },
    setItem: (key, value) => {
      const cleanKey = normalizeDesktopStateKey(key);
      if (!cleanKey) {
        return;
      }
      ipcRenderer.sendSync(DESKTOP_STATE_SET_CHANNEL, {
        key: cleanKey,
        value: String(value ?? ''),
      });
    },
    removeItem: (key) => {
      const cleanKey = normalizeDesktopStateKey(key);
      if (!cleanKey) {
        return;
      }
      ipcRenderer.sendSync(DESKTOP_STATE_REMOVE_CHANNEL, cleanKey);
    },
    keys: () => {
      const value = ipcRenderer.sendSync(DESKTOP_STATE_KEYS_CHANNEL);
      return Array.isArray(value)
        ? value.map((item) => normalizeDesktopStateKey(item)).filter(Boolean)
        : [];
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopStateStorage', bridge);
}
