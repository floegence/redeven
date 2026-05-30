/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  LIST_DESKTOP_FLOWER_HOST_THREADS_CHANNEL,
  LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL,
  SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSettingsDraft,
  type ListDesktopFlowerHostThreadsResult,
  type LoadDesktopFlowerHostSettingsResult,
  type SendDesktopFlowerHostChatResult,
  type SaveDesktopFlowerHostSettingsResult,
} from '../shared/flowerHostSettingsIPC';

export function bootstrapDesktopSettingsBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopSettings', {
    save: (draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> =>
      ipcRenderer.invoke(SAVE_DESKTOP_SETTINGS_CHANNEL, draft),
    loadFlowerHostSettings: (): Promise<LoadDesktopFlowerHostSettingsResult> =>
      ipcRenderer.invoke(LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL),
    saveFlowerHostSettings: (draft: DesktopFlowerHostSettingsDraft): Promise<SaveDesktopFlowerHostSettingsResult> =>
      ipcRenderer.invoke(SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL, draft),
    listFlowerHostThreads: (): Promise<ListDesktopFlowerHostThreadsResult> =>
      ipcRenderer.invoke(LIST_DESKTOP_FLOWER_HOST_THREADS_CHANNEL),
    sendFlowerHostChat: (request: DesktopFlowerHostSendChatRequest): Promise<SendDesktopFlowerHostChatResult> =>
      ipcRenderer.invoke(SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL, request),
    cancel: (): void => {
      ipcRenderer.send(CANCEL_DESKTOP_SETTINGS_CHANNEL);
    },
  });
}
