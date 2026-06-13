/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  FORK_DESKTOP_FLOWER_HOST_THREAD_CHANNEL,
  LIST_DESKTOP_FLOWER_HOST_THREADS_CHANNEL,
  LOAD_DESKTOP_FLOWER_HOST_THREAD_CHANNEL,
  LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  MARK_DESKTOP_FLOWER_HOST_THREAD_READ_CHANNEL,
  RENAME_DESKTOP_FLOWER_HOST_THREAD_CHANNEL,
  RESOLVE_DESKTOP_FLOWER_HOST_HANDLER_CHANNEL,
  SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL,
  SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL,
  SET_DESKTOP_FLOWER_HOST_THREAD_PINNED_CHANNEL,
  SUBMIT_DESKTOP_FLOWER_HOST_INPUT_CHANNEL,
  type DesktopFlowerHostForkThreadRequest,
  type DesktopFlowerHostMarkThreadReadRequest,
  type DesktopFlowerHostRenameThreadRequest,
  type DesktopFlowerHostResolveHandlerRequest,
  type DesktopFlowerHostSendChatRequest,
  type DesktopFlowerHostSetThreadPinnedRequest,
  type DesktopFlowerHostSettingsDraft,
  type DesktopFlowerHostSubmitInputRequest,
  type ForkDesktopFlowerHostThreadResult,
  type ListDesktopFlowerHostThreadsResult,
  type LoadDesktopFlowerHostThreadResult,
  type LoadDesktopFlowerHostSettingsResult,
  type MarkDesktopFlowerHostThreadReadResult,
  type RenameDesktopFlowerHostThreadResult,
  type ResolveDesktopFlowerHostHandlerResult,
  type SendDesktopFlowerHostChatResult,
  type SaveDesktopFlowerHostSettingsResult,
  type SetDesktopFlowerHostThreadPinnedResult,
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
    markFlowerHostThreadRead: (request: DesktopFlowerHostMarkThreadReadRequest): Promise<MarkDesktopFlowerHostThreadReadResult> =>
      ipcRenderer.invoke(MARK_DESKTOP_FLOWER_HOST_THREAD_READ_CHANNEL, request),
    renameFlowerHostThread: (request: DesktopFlowerHostRenameThreadRequest): Promise<RenameDesktopFlowerHostThreadResult> =>
      ipcRenderer.invoke(RENAME_DESKTOP_FLOWER_HOST_THREAD_CHANNEL, request),
    setFlowerHostThreadPinned: (request: DesktopFlowerHostSetThreadPinnedRequest): Promise<SetDesktopFlowerHostThreadPinnedResult> =>
      ipcRenderer.invoke(SET_DESKTOP_FLOWER_HOST_THREAD_PINNED_CHANNEL, request),
    forkFlowerHostThread: (request: DesktopFlowerHostForkThreadRequest): Promise<ForkDesktopFlowerHostThreadResult> =>
      ipcRenderer.invoke(FORK_DESKTOP_FLOWER_HOST_THREAD_CHANNEL, request),
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
