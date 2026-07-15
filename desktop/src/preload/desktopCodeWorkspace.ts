/// <reference lib="dom" />

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  DESKTOP_CODE_WORKSPACE_CANCEL_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PROGRESS_CHANNEL,
  normalizeDesktopCodeWorkspaceCancelRequest,
  normalizeDesktopCodeWorkspaceCancelResponse,
  normalizeDesktopCodeWorkspacePackageChunkRequest,
  normalizeDesktopCodeWorkspacePackageChunkResponse,
  normalizeDesktopCodeWorkspacePackageDisposeRequest,
  normalizeDesktopCodeWorkspacePackageDisposeResponse,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspacePrepareRequest,
  normalizeDesktopCodeWorkspacePrepareResponse,
  normalizeDesktopCodeWorkspaceProgress,
  type DesktopCodeWorkspaceCancelResponse,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspacePrepareResponse,
  type DesktopCodeWorkspaceProgress,
} from '../shared/desktopCodeWorkspaceIPC';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEngine: (request?: unknown) => Promise<DesktopCodeWorkspacePrepareResponse>;
  prepareWorkspaceEnginePackage: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
  cancelWorkspaceEnginePreparation: (request?: unknown) => Promise<DesktopCodeWorkspaceCancelResponse>;
  subscribeWorkspaceEngineProgress: (listener: (progress: DesktopCodeWorkspaceProgress) => void) => () => void;
}

declare global {
  interface Window {
    redevenDesktopCodeWorkspace?: DesktopCodeWorkspaceBridge;
  }
}

export function bootstrapDesktopCodeWorkspaceBridge(): void {
  const bridge: DesktopCodeWorkspaceBridge = {
    prepareWorkspaceEngine: async (request?: unknown) => {
      const normalized = normalizeDesktopCodeWorkspacePrepareRequest(request);
      return normalizeDesktopCodeWorkspacePrepareResponse(
        await ipcRenderer.invoke(DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL, normalized),
      );
    },
    prepareWorkspaceEnginePackage: async (request?: unknown) => {
      const normalized = normalizeDesktopCodeWorkspacePackagePrepareRequest(request);
      if (!normalized) {
        return normalizeDesktopCodeWorkspacePackagePrepareResponse(null);
      }
      return normalizeDesktopCodeWorkspacePackagePrepareResponse(
        await ipcRenderer.invoke(DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL, normalized),
      );
    },
    readWorkspaceEnginePackageChunk: async (request?: unknown) => {
      const normalized = normalizeDesktopCodeWorkspacePackageChunkRequest(request);
      if (!normalized) {
        return normalizeDesktopCodeWorkspacePackageChunkResponse(null);
      }
      return normalizeDesktopCodeWorkspacePackageChunkResponse(
        await ipcRenderer.invoke(DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL, normalized),
      );
    },
    disposeWorkspaceEnginePackage: async (request?: unknown) => {
      const normalized = normalizeDesktopCodeWorkspacePackageDisposeRequest(request);
      if (!normalized) {
        return normalizeDesktopCodeWorkspacePackageDisposeResponse(null);
      }
      return normalizeDesktopCodeWorkspacePackageDisposeResponse(
        await ipcRenderer.invoke(DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL, normalized),
      );
    },
    cancelWorkspaceEnginePreparation: async (request?: unknown) => {
      const normalized = normalizeDesktopCodeWorkspaceCancelRequest(request);
      if (!normalized) {
        return normalizeDesktopCodeWorkspaceCancelResponse(null);
      }
      return normalizeDesktopCodeWorkspaceCancelResponse(
        await ipcRenderer.invoke(DESKTOP_CODE_WORKSPACE_CANCEL_CHANNEL, normalized),
      );
    },
    subscribeWorkspaceEngineProgress: (listener: (progress: DesktopCodeWorkspaceProgress) => void) => {
      if (typeof listener !== 'function') return () => undefined;
      const wrappedListener = (_event: IpcRendererEvent, rawProgress: unknown) => {
        const progress = normalizeDesktopCodeWorkspaceProgress(rawProgress);
        if (progress) listener(progress);
      };
      ipcRenderer.on(DESKTOP_CODE_WORKSPACE_PROGRESS_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(DESKTOP_CODE_WORKSPACE_PROGRESS_CHANNEL, wrappedListener);
      };
    },
  };
  contextBridge.exposeInMainWorld('redevenDesktopCodeWorkspace', bridge);
}
