/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SESSION_APP_READY_CHANNEL,
  DESKTOP_SESSION_CONTEXT_GET_CHANNEL,
  type DesktopSessionAppReadyPayload,
  type DesktopSessionContextSnapshot,
} from '../shared/desktopSessionContextIPC';

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
  notifyAppReady: (payload: DesktopSessionAppReadyPayload) => void;
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
      const localEnvironmentID = String(candidate.local_environment_id ?? '').trim();
      const environmentStorageScopeID = String(candidate.environment_storage_scope_id ?? '').trim();
      const providerOrigin = String(candidate.provider_origin ?? '').trim();
      const providerID = String(candidate.provider_id ?? '').trim();
      const envPublicID = String(candidate.env_public_id ?? '').trim();
      if (localEnvironmentID === '' || environmentStorageScopeID === '') {
        return null;
      }
      return {
        local_environment_id: localEnvironmentID,
        environment_storage_scope_id: environmentStorageScopeID,
        ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
        ...(providerID !== '' ? { provider_id: providerID } : {}),
        ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
      };
    },
    notifyAppReady: (payload) => {
      const state = String(payload?.state ?? '').trim();
      if (state !== 'access_gate_interactive' && state !== 'runtime_connected') {
        return;
      }
      ipcRenderer.send(DESKTOP_SESSION_APP_READY_CHANNEL, { state });
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopSessionContext', bridge);
}
