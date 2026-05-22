/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_CODE_WORKSPACE_PACKAGE_CHUNK_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_DISPOSE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PACKAGE_PREPARE_CHANNEL,
  DESKTOP_CODE_WORKSPACE_PREPARE_CHANNEL,
  normalizeDesktopCodeWorkspacePackageChunkRequest,
  normalizeDesktopCodeWorkspacePackageChunkResponse,
  normalizeDesktopCodeWorkspacePackageDisposeRequest,
  normalizeDesktopCodeWorkspacePackageDisposeResponse,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspacePrepareRequest,
  normalizeDesktopCodeWorkspacePrepareResponse,
  type DesktopCodeWorkspacePackageChunkResponse,
  type DesktopCodeWorkspacePackageDisposeResponse,
  type DesktopCodeWorkspacePackagePrepareResponse,
  type DesktopCodeWorkspacePrepareResponse,
} from '../shared/desktopCodeWorkspaceIPC';

export interface DesktopCodeWorkspaceBridge {
  prepareWorkspaceEngine: (request?: unknown) => Promise<DesktopCodeWorkspacePrepareResponse>;
  prepareWorkspaceEnginePackage: (request?: unknown) => Promise<DesktopCodeWorkspacePackagePrepareResponse>;
  readWorkspaceEnginePackageChunk: (request?: unknown) => Promise<DesktopCodeWorkspacePackageChunkResponse>;
  disposeWorkspaceEnginePackage: (request?: unknown) => Promise<DesktopCodeWorkspacePackageDisposeResponse>;
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
  };
  contextBridge.exposeInMainWorld('redevenDesktopCodeWorkspace', bridge);
}
