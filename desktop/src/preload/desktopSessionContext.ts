/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_SESSION_APP_READY_CHANNEL,
  DESKTOP_SESSION_CONTEXT_GET_CHANNEL,
  type DesktopSessionAppReadyPayload,
  type DesktopSessionContextSnapshot,
} from '../shared/desktopSessionContextIPC';
import { parseLocalUIExposure } from '../shared/localUIExposure';

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
      const rendererStorageScopeID = String(candidate.renderer_storage_scope_id ?? '').trim();
      const targetKind = String(candidate.target_kind ?? '').trim();
      const targetRoute = String(candidate.target_route ?? '').trim();
      const sessionSource = String(candidate.session_source ?? '').trim();
      const providerOrigin = String(candidate.provider_origin ?? '').trim();
      const providerID = String(candidate.provider_id ?? '').trim();
      const envPublicID = String(candidate.env_public_id ?? '').trim();
      const label = String(candidate.label ?? '').trim();
      const localUIExposure = (() => {
        try {
          return candidate.local_ui_exposure == null ? undefined : parseLocalUIExposure(candidate.local_ui_exposure);
        } catch {
          return undefined;
        }
      })();
      if (localEnvironmentID === '' || rendererStorageScopeID === '') {
        return null;
      }
      return {
        local_environment_id: localEnvironmentID,
        renderer_storage_scope_id: rendererStorageScopeID,
        ...(targetKind === 'local_environment' || targetKind === 'external_local_ui' || targetKind === 'ssh_environment' || targetKind === 'gateway_environment' ? { target_kind: targetKind } : {}),
        ...(targetRoute === 'local_host' || targetRoute === 'remote_desktop' ? { target_route: targetRoute } : {}),
        ...(sessionSource === 'local_runtime' || sessionSource === 'provider_environment' || sessionSource === 'ssh_environment' || sessionSource === 'external_local_ui' || sessionSource === 'runtime_gateway' ? { session_source: sessionSource } : {}),
        ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
        ...(providerID !== '' ? { provider_id: providerID } : {}),
        ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
        ...(label !== '' ? { label } : {}),
        ...(localUIExposure ? { local_ui_exposure: localUIExposure } : {}),
      };
    },
    notifyAppReady: (payload) => {
      const state = String(payload?.state ?? '').trim();
      if (state !== 'access_gate_interactive' && state !== 'runtime_connected') {
        return;
      }
      const timings = payload?.timings && typeof payload.timings === 'object'
        ? Object.fromEntries(Object.entries(payload.timings).flatMap(([key, value]) => {
            const numberValue = Number(value);
            return ['bootstrap_ms', 'access_ready_ms', 'protocol_connected_ms', 'shell_painted_ms'].includes(key)
              && Number.isFinite(numberValue)
              && numberValue >= 0
              && numberValue <= 300_000
              ? [[key, Math.round(numberValue)]]
              : [];
          }))
        : {};
      ipcRenderer.send(DESKTOP_SESSION_APP_READY_CHANNEL, {
        state,
        ...(Object.keys(timings).length > 0 ? { timings } : {}),
      });
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopSessionContext', bridge);
}
