/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';

export function bootstrapDesktopSettingsBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopSettings', {
    save: (draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> =>
      ipcRenderer.invoke(SAVE_DESKTOP_SETTINGS_CHANNEL, draft),
    cancel: (): void => {
      ipcRenderer.send(CANCEL_DESKTOP_SETTINGS_CHANNEL);
    },
  });
}
