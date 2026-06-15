/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  REQUEST_RUNTIME_FLOWER_CHANNEL,
  type RuntimeFlowerRequest,
  type RuntimeFlowerRequestResult,
} from '../shared/runtimeFlowerIPC';

export function bootstrapDesktopSettingsBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopSettings', {
    save: (draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> =>
      ipcRenderer.invoke(SAVE_DESKTOP_SETTINGS_CHANNEL, draft),
    requestRuntimeFlower: (request: RuntimeFlowerRequest): Promise<RuntimeFlowerRequestResult> =>
      ipcRenderer.invoke(REQUEST_RUNTIME_FLOWER_CHANNEL, request),
    cancel: (): void => {
      ipcRenderer.send(CANCEL_DESKTOP_SETTINGS_CHANNEL);
    },
  });
}
