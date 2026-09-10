/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';
import {
  TEMPLATE_SOURCE_ACQUIRE_CHANNEL,
  TEMPLATE_SOURCE_CANCEL_CHANNEL,
  normalizeTemplateSourceRequest,
  type DesktopTemplateSourceBridge,
  type TemplateSourceAcquireResponse,
} from '../shared/desktopTemplateSources';

export function bootstrapDesktopTemplateSources(): void {
  const bridge: DesktopTemplateSourceBridge = {
    acquire: async (request) => {
      const normalized = normalizeTemplateSourceRequest(request);
      if (!normalized) return { ok: false, error_code: 'REQUEST_INVALID' };
      return (await ipcRenderer.invoke(TEMPLATE_SOURCE_ACQUIRE_CHANNEL, normalized)) as TemplateSourceAcquireResponse;
    },
    cancel: async (operationID) => {
      if (/^[a-zA-Z0-9_-]{1,128}$/u.test(operationID))
        await ipcRenderer.invoke(TEMPLATE_SOURCE_CANCEL_CHANNEL, operationID);
    },
  };
  contextBridge.exposeInMainWorld('redevenDesktopTemplateSources', bridge);
}
