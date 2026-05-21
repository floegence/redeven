/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_DOWNLOAD_ABORT_CHANNEL,
  DESKTOP_DOWNLOAD_COMPLETE_CHANNEL,
  DESKTOP_DOWNLOAD_OPEN_CHANNEL,
  DESKTOP_DOWNLOAD_PREPARE_CHANNEL,
  DESKTOP_DOWNLOAD_REVEAL_CHANNEL,
  DESKTOP_DOWNLOAD_WRITE_CHANNEL,
  normalizeDesktopDownloadActionResponse,
  normalizeDesktopDownloadCompleteResponse,
  normalizeDesktopDownloadPrepareRequest,
  normalizeDesktopDownloadPrepareResponse,
  normalizeDesktopDownloadAbortRequest,
  normalizeDesktopDownloadActionRequest,
  normalizeDesktopDownloadCompleteRequest,
  normalizeDesktopDownloadWriteRequest,
} from '../shared/desktopDownloadIPC';

export function bootstrapDesktopDownloadsBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopDownloads', {
    prepare: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadPrepareRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadPrepareResponse(null);
      }
      return normalizeDesktopDownloadPrepareResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_PREPARE_CHANNEL, normalized),
      );
    },
    write: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadWriteRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadActionResponse(null);
      }
      return normalizeDesktopDownloadActionResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_WRITE_CHANNEL, normalized),
      );
    },
    complete: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadCompleteRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadCompleteResponse(null);
      }
      return normalizeDesktopDownloadCompleteResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_COMPLETE_CHANNEL, normalized),
      );
    },
    abort: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadAbortRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadActionResponse(null);
      }
      return normalizeDesktopDownloadActionResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_ABORT_CHANNEL, normalized),
      );
    },
    reveal: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadActionRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadActionResponse(null);
      }
      return normalizeDesktopDownloadActionResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_REVEAL_CHANNEL, normalized),
      );
    },
    open: async (request: unknown) => {
      const normalized = normalizeDesktopDownloadActionRequest(request);
      if (!normalized) {
        return normalizeDesktopDownloadActionResponse(null);
      }
      return normalizeDesktopDownloadActionResponse(
        await ipcRenderer.invoke(DESKTOP_DOWNLOAD_OPEN_CHANNEL, normalized),
      );
    },
  });
}
