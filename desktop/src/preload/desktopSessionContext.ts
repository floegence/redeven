/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SESSION_CONTEXT_GET_CHANNEL,
  type DesktopSessionContextSnapshot,
} from '../shared/desktopSessionContextIPC';

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
}

declare global {
  interface Window {
    redevenDesktopSessionContext?: DesktopSessionContextBridge;
  }
}

export function bootstrapDesktopSessionContextBridge(): void {
  const bridge: DesktopSessionContextBridge = {
    getSnapshot: () => {
      const value = ipcRenderer.sendSync(DESKTOP_SESSION_CONTEXT_GET_CHANNEL);
      if (!value || typeof value !== 'object') {
        return null;
      }
      const candidate = value as Partial<DesktopSessionContextSnapshot>;
      const managedEnvironmentID = String(candidate.managed_environment_id ?? '').trim();
      const environmentStorageScopeID = String(candidate.environment_storage_scope_id ?? '').trim();
      if (managedEnvironmentID === '' || environmentStorageScopeID === '') {
        return null;
      }
      return {
        managed_environment_id: managedEnvironmentID,
        environment_storage_scope_id: environmentStorageScopeID,
      };
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopSessionContext', bridge);
}
