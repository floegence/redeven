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
  LOAD_DESKTOP_FLOWER_HOST_THREAD_CHANNEL,
  LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  RESOLVE_DESKTOP_FLOWER_HOST_HANDLER_CHANNEL,
  SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL,
  SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  SUBMIT_DESKTOP_FLOWER_HOST_INPUT_CHANNEL,
  type DesktopFlowerHostResolveHandlerRequest,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSubmitInputRequest,
  type ListDesktopFlowerHostThreadsResult,
  type LoadDesktopFlowerHostThreadResult,
  type LoadDesktopFlowerHostSettingsResult,
  type ResolveDesktopFlowerHostHandlerResult,
  type SendDesktopFlowerHostChatResult,
  type SaveDesktopFlowerHostSettingsResult,
  type SubmitDesktopFlowerHostInputResult,
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
    loadFlowerHostThread: (threadID: string): Promise<LoadDesktopFlowerHostThreadResult> =>
      ipcRenderer.invoke(LOAD_DESKTOP_FLOWER_HOST_THREAD_CHANNEL, threadID),
    resolveFlowerHostHandler: (request?: DesktopFlowerHostResolveHandlerRequest): Promise<ResolveDesktopFlowerHostHandlerResult> =>
      ipcRenderer.invoke(RESOLVE_DESKTOP_FLOWER_HOST_HANDLER_CHANNEL, request),
    sendFlowerHostChat: (request: DesktopFlowerHostSendChatRequest): Promise<SendDesktopFlowerHostChatResult> =>
      ipcRenderer.invoke(SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL, request),
    submitFlowerHostInput: (request: DesktopFlowerHostSubmitInputRequest): Promise<SubmitDesktopFlowerHostInputResult> =>
      ipcRenderer.invoke(SUBMIT_DESKTOP_FLOWER_HOST_INPUT_CHANNEL, request),
    cancel: (): void => {
      ipcRenderer.send(CANCEL_DESKTOP_SETTINGS_CHANNEL);
    },
  });
}
