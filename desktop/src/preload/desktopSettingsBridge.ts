/// <reference lib="dom" />

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  CANCEL_DESKTOP_SETTINGS_CHANNEL,
  SAVE_DESKTOP_SETTINGS_CHANNEL,
  type DesktopSettingsDraft,
  type SaveDesktopSettingsResult,
} from '../shared/settingsIPC';
import {
  CANCEL_RUNTIME_FLOWER_STREAM_CHANNEL,
  REQUEST_RUNTIME_FLOWER_CHANNEL,
  RUNTIME_FLOWER_STREAM_EVENT_CHANNEL,
  START_RUNTIME_FLOWER_STREAM_CHANNEL,
  normalizeRuntimeFlowerStreamEvent,
  normalizeRuntimeFlowerStreamID,
  normalizeRuntimeFlowerStreamRequest,
  type RuntimeFlowerRequest,
  type RuntimeFlowerRequestResult,
  type RuntimeFlowerStreamEvent,
  type RuntimeFlowerStreamStartResult,
} from '../shared/runtimeFlowerIPC';
import {
  CANCEL_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  COMMIT_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  PREPARE_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  PREVIEW_RUNTIME_FLOWER_ATTACHMENT_CHANNEL,
  RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL,
  WRITE_RUNTIME_FLOWER_ATTACHMENT_CHUNK_CHANNEL,
  normalizeRuntimeFlowerAttachmentChunkRequest,
  normalizeRuntimeFlowerAttachmentOperationRequest,
  normalizeRuntimeFlowerAttachmentPreviewRequest,
  normalizeRuntimeFlowerAttachmentPrepareRequest,
  normalizeRuntimeFlowerAttachmentProgress,
  type RuntimeFlowerAttachmentCancelResponse,
  type RuntimeFlowerAttachmentChunkResponse,
  type RuntimeFlowerAttachmentCommitResponse,
  type RuntimeFlowerAttachmentPrepareResponse,
  type RuntimeFlowerAttachmentProgress,
  type RuntimeFlowerAttachmentPreviewResponse,
} from '../shared/runtimeFlowerAttachmentIPC';

export function bootstrapDesktopSettingsBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopSettings', {
    save: (draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> =>
      ipcRenderer.invoke(SAVE_DESKTOP_SETTINGS_CHANNEL, draft),
    requestRuntimeFlower: (request: RuntimeFlowerRequest): Promise<RuntimeFlowerRequestResult> =>
      ipcRenderer.invoke(REQUEST_RUNTIME_FLOWER_CHANNEL, request),
    startRuntimeFlowerStream: async (request: unknown): Promise<RuntimeFlowerStreamStartResult> => {
      const normalized = normalizeRuntimeFlowerStreamRequest(request);
      if (!normalized) return { ok: false, error: { code: 'runtime_flower_invalid_stream', message: 'Invalid Flower stream request.' } };
      return ipcRenderer.invoke(START_RUNTIME_FLOWER_STREAM_CHANNEL, normalized);
    },
    cancelRuntimeFlowerStream: (streamID: unknown): void => {
      const normalized = normalizeRuntimeFlowerStreamID(streamID);
      if (normalized) ipcRenderer.send(CANCEL_RUNTIME_FLOWER_STREAM_CHANNEL, normalized);
    },
    subscribeRuntimeFlowerStream: (listener: (event: RuntimeFlowerStreamEvent) => void): (() => void) => {
      if (typeof listener !== 'function') return () => undefined;
      const wrapped = (_event: IpcRendererEvent, value: unknown) => {
        const normalized = normalizeRuntimeFlowerStreamEvent(value);
        if (normalized) listener(normalized);
      };
      ipcRenderer.on(RUNTIME_FLOWER_STREAM_EVENT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(RUNTIME_FLOWER_STREAM_EVENT_CHANNEL, wrapped);
    },
    prepareRuntimeFlowerAttachment: async (request: unknown): Promise<RuntimeFlowerAttachmentPrepareResponse> => {
      const normalized = normalizeRuntimeFlowerAttachmentPrepareRequest(request);
      if (!normalized) return { ok: false, message: 'Invalid Flower attachment upload request.' };
      return ipcRenderer.invoke(PREPARE_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, normalized);
    },
    writeRuntimeFlowerAttachmentChunk: async (request: unknown): Promise<RuntimeFlowerAttachmentChunkResponse> => {
      const normalized = normalizeRuntimeFlowerAttachmentChunkRequest(request);
      if (!normalized) return { ok: false, message: 'Invalid Flower attachment upload chunk.' };
      return ipcRenderer.invoke(WRITE_RUNTIME_FLOWER_ATTACHMENT_CHUNK_CHANNEL, normalized);
    },
    commitRuntimeFlowerAttachment: async (request: unknown): Promise<RuntimeFlowerAttachmentCommitResponse> => {
      const normalized = normalizeRuntimeFlowerAttachmentOperationRequest(request);
      if (!normalized) return { ok: false, failureKind: 'local', error: { message: 'Invalid Flower attachment upload commit.' } };
      return ipcRenderer.invoke(COMMIT_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, normalized);
    },
    cancelRuntimeFlowerAttachment: async (request: unknown): Promise<RuntimeFlowerAttachmentCancelResponse> => {
      const normalized = normalizeRuntimeFlowerAttachmentOperationRequest(request);
      if (!normalized) return { ok: false, cancelled: false, message: 'Invalid Flower attachment upload cancellation.' };
      return ipcRenderer.invoke(CANCEL_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, normalized);
    },
    previewRuntimeFlowerAttachment: async (request: unknown): Promise<RuntimeFlowerAttachmentPreviewResponse> => {
      const normalized = normalizeRuntimeFlowerAttachmentPreviewRequest(request);
      if (!normalized) return { ok: false, message: 'Invalid Flower attachment preview request.' };
      return ipcRenderer.invoke(PREVIEW_RUNTIME_FLOWER_ATTACHMENT_CHANNEL, normalized);
    },
    subscribeRuntimeFlowerAttachmentProgress: (listener: (progress: RuntimeFlowerAttachmentProgress) => void): (() => void) => {
      if (typeof listener !== 'function') return () => undefined;
      const wrapped = (_event: IpcRendererEvent, value: unknown) => {
        const progress = normalizeRuntimeFlowerAttachmentProgress(value);
        if (progress) listener(progress);
      };
      ipcRenderer.on(RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL, wrapped);
    },
    cancel: (): void => {
      ipcRenderer.send(CANCEL_DESKTOP_SETTINGS_CHANNEL);
    },
  });
}
