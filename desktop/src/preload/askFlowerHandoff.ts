/// <reference lib="dom" />

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL,
  DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL,
  normalizeDesktopAskFlowerHandoffPayload,
  type DesktopAskFlowerHandoffBridge,
  type DesktopAskFlowerHandoffPayload,
} from '../shared/askFlowerHandoffIPC';

export function bootstrapDesktopAskFlowerHandoffBridge(): void {
  const listeners = new Set<(payload: DesktopAskFlowerHandoffPayload) => void>();
  const pendingPayloads: DesktopAskFlowerHandoffPayload[] = [];

  const dispatchPayload = (payload: DesktopAskFlowerHandoffPayload) => {
    if (listeners.size <= 0) {
      pendingPayloads.push(payload);
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  };

  ipcRenderer.on(DESKTOP_ASK_FLOWER_HANDOFF_DELIVER_CHANNEL, (_event: IpcRendererEvent, payload: unknown) => {
    const normalized = normalizeDesktopAskFlowerHandoffPayload(payload);
    if (!normalized) {
      return;
    }
    dispatchPayload(normalized);
  });

  const bridge: DesktopAskFlowerHandoffBridge = {
    requestMainWindowHandoff: (payload) => {
      const normalized = normalizeDesktopAskFlowerHandoffPayload(payload);
      if (!normalized) {
        return;
      }
      ipcRenderer.send(DESKTOP_ASK_FLOWER_HANDOFF_REQUEST_CHANNEL, normalized);
    },
    onMainWindowHandoff: (listener) => {
      if (typeof listener !== 'function') {
        return () => undefined;
      }

      listeners.add(listener);
      if (pendingPayloads.length > 0) {
        const queue = pendingPayloads.splice(0, pendingPayloads.length);
        for (const payload of queue) {
          listener(payload);
        }
      }

      return () => {
        listeners.delete(listener);
      };
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopAskFlowerHandoff', bridge);
}
