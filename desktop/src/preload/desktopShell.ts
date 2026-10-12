/// <reference lib="dom" />

import { REMOTE_DESKTOP_FILES_CHANNEL } from '../shared/hostApplicationWindowIPC';
import { contextBridge, ipcRenderer } from 'electron';
import { REMOTE_DESKTOP_DEPLOYMENT_CHANNEL, REMOTE_DESKTOP_DEPLOYMENT_PROGRESS, parseDesktopDeploymentRequest, parseDesktopDeploymentProgress, type DesktopDeploymentRequest, type DesktopDeploymentResult, type DesktopDeploymentProgress } from '../shared/remoteDesktopDeployment';
import { HOST_APPLICATION_COMPONENTS_CHANNEL, HOST_APPLICATION_COMPONENTS_PROGRESS, type HostApplicationComponentsRequest, type HostApplicationComponentsResult, type HostApplicationComponentsProgress } from '../shared/hostApplicationComponents';
import { HOST_APPLICATION_PREPARATION_CHANNEL, HOST_APPLICATION_PREPARATION_CLOSED_CHANNEL, type HostApplicationPreparationRequest, type HostApplicationPreparationResult } from '../shared/hostApplicationPreparation';

import {
  DESKTOP_SHELL_OPEN_WINDOW_CHANNEL,
  normalizeDesktopShellWindowKind,
} from '../shared/desktopShellWindowIPC';
import {
  DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL,
  normalizeDesktopShellWindowCommand,
  normalizeDesktopShellWindowCommandResponse,
} from '../shared/desktopShellWindowCommandIPC';
import {
  DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL,
  DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL,
  DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL,
  normalizeDesktopShellRuntimeActionRequest,
  normalizeDesktopShellRuntimeMaintenanceContext,
  normalizeDesktopShellRuntimeActionResponse,
} from '../shared/desktopShellRuntimeIPC';
import {
  DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL,
  DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL,
  normalizeDesktopShellOpenExternalURLResponse,
} from '../shared/desktopShellExternalURLIPC';
import {
  DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL,
  normalizeDesktopShellOpenCodespaceWindowResponse,
} from '../shared/desktopShellCodespaceWindowIPC';
import {
  MANAGED_ENTRANCE_REQUEST, MANAGED_ENTRANCE_RESPONSE, MANAGED_ENTRANCE_CANCEL, type ManagedEntrancePreparationRequest,
  DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL,
  normalizeDesktopShellOpenWebServiceWindowResponse,
} from '../shared/desktopShellWebServiceWindowIPC';
import {
  DESKTOP_SHELL_OPEN_SERVICE_CANVAS_WINDOW_CHANNEL,
  normalizeDesktopShellOpenServiceCanvasWindowResponse,
} from '../shared/desktopShellServiceCanvasWindowIPC';

export function bootstrapDesktopShellBridge(): void {
  contextBridge.exposeInMainWorld('redevenDesktopShell', {
    onManagedEntranceRequest: (listener: (request: ManagedEntrancePreparationRequest) => Promise<unknown>): (() => void) => {
      const pending = new Map<string, ManagedEntrancePreparationRequest>();
      const cancel = (_event: unknown, id: unknown) => {
        if (typeof id !== 'string') return;
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        void listener({ ...request, cancel: true }).catch(() => {});
      };
      const receive = (_event: unknown, request: ManagedEntrancePreparationRequest) => {
        if (!request || !/^[a-f0-9-]{36}$/u.test(request.request_id) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(request.service_id) || typeof request.refresh !== 'boolean' || pending.has(request.request_id)) return;
        pending.set(request.request_id, request);
        void listener(request).then(result => {
          if (!pending.has(request.request_id)) return;
          const raw = JSON.stringify(result);
          ipcRenderer.send(MANAGED_ENTRANCE_RESPONSE, request.request_id, raw && raw.length <= 65536 ? raw : 'null');
        }).catch(() => {
          if (pending.has(request.request_id)) ipcRenderer.send(MANAGED_ENTRANCE_RESPONSE, request.request_id, 'null');
        }).finally(() => pending.delete(request.request_id));
      };
      ipcRenderer.on(MANAGED_ENTRANCE_REQUEST, receive);
      ipcRenderer.on(MANAGED_ENTRANCE_CANCEL, cancel);
      return () => {
        for (const id of pending.keys()) cancel(undefined, id);
        ipcRenderer.removeListener(MANAGED_ENTRANCE_REQUEST, receive);
        ipcRenderer.removeListener(MANAGED_ENTRANCE_CANCEL, cancel);
      };
    },
    remoteDesktopDeployment: async (request: DesktopDeploymentRequest): Promise<DesktopDeploymentResult> => {
      const normalized = parseDesktopDeploymentRequest(request);
      if (!normalized) return { ok: false, code: 'invalid_request' };
      return ipcRenderer.invoke(REMOTE_DESKTOP_DEPLOYMENT_CHANNEL, normalized);
    },
    onRemoteDesktopDeploymentProgress: (listener: (value: DesktopDeploymentProgress) => void) => {
      const receive = (_event: unknown, value: unknown) => { const progress = parseDesktopDeploymentProgress(value); if (progress) listener(progress); };
      ipcRenderer.on(REMOTE_DESKTOP_DEPLOYMENT_PROGRESS, receive);
      return () => ipcRenderer.removeListener(REMOTE_DESKTOP_DEPLOYMENT_PROGRESS, receive);
    },
    onRemoteDesktopFiles: (listener: () => void): (() => void) => {
      const receive = () => listener();
      ipcRenderer.on(REMOTE_DESKTOP_FILES_CHANNEL, receive);
      return () => ipcRenderer.removeListener(REMOTE_DESKTOP_FILES_CHANNEL, receive);
    },
    openConnectionCenter: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'connection_center' });
    },
    openAdvancedSettings: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'settings' });
    },
    openFlowerSettings: async (): Promise<void> => {
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: 'flower_settings' });
    },
    openWindow: async (kind: unknown): Promise<void> => {
      const normalized = normalizeDesktopShellWindowKind(kind);
      if (!normalized) {
        return;
      }
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WINDOW_CHANNEL, { kind: normalized });
    },
    performWindowCommand: async (command: unknown) => {
      const normalized = normalizeDesktopShellWindowCommand(command);
      if (!normalized) {
        return normalizeDesktopShellWindowCommandResponse(null);
      }
      return normalizeDesktopShellWindowCommandResponse(
        await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: normalized }),
      );
    },
    minimizeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'minimize' }),
    ),
    closeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'close' }),
    ),
    toggleMaximizeWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'toggle_maximize' }),
    ),
    toggleFullScreenWindow: async () => normalizeDesktopShellWindowCommandResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL, { command: 'toggle_full_screen' }),
    ),
    openExternalURL: async (url: string) => normalizeDesktopShellOpenExternalURLResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL, { url }),
    ),
    openCodespaceWindow: async (request: unknown) => normalizeDesktopShellOpenCodespaceWindowResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL, request),
    ),
    openWebServiceWindow: async (request: unknown) => normalizeDesktopShellOpenWebServiceWindowResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL, request),
    ),
    openServiceCanvasWindow: async (request: unknown) => normalizeDesktopShellOpenServiceCanvasWindowResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_SERVICE_CANVAS_WINDOW_CHANNEL, request),
    ),
    applicationComponents: async (request: HostApplicationComponentsRequest): Promise<HostApplicationComponentsResult> => ipcRenderer.invoke(HOST_APPLICATION_COMPONENTS_CHANNEL, request),
    onApplicationComponentsProgress: (listener: (value: HostApplicationComponentsProgress) => void) => {
      const receive = (_event: unknown, value: HostApplicationComponentsProgress) => listener(value);
      ipcRenderer.on(HOST_APPLICATION_COMPONENTS_PROGRESS, receive);
      return () => ipcRenderer.removeListener(HOST_APPLICATION_COMPONENTS_PROGRESS, receive);
    },
    applicationPreparation: async (request: HostApplicationPreparationRequest): Promise<HostApplicationPreparationResult> => {
      const result = await ipcRenderer.invoke(HOST_APPLICATION_PREPARATION_CHANNEL, request);
      return { ok: result?.ok === true, ...(typeof result?.id === 'string' ? { id: result.id } : {}) };
    },
    onApplicationPreparationClosed: (listener: (id: string) => void) => {
      const receive = (_event: unknown, id: unknown) => { if (typeof id === 'string') listener(id); };
      ipcRenderer.on(HOST_APPLICATION_PREPARATION_CLOSED_CHANNEL, receive);
      return () => ipcRenderer.removeListener(HOST_APPLICATION_PREPARATION_CLOSED_CHANNEL, receive);
    },
    openDashboard: async () => normalizeDesktopShellOpenExternalURLResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL),
    ),
    getRuntimeMaintenanceContext: async () => normalizeDesktopShellRuntimeMaintenanceContext(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_MAINTENANCE_CONTEXT_CHANNEL),
    ),
    notifyRuntimeMaintenanceStarted: (kind: unknown): void => {
      if (kind !== 'restart' && kind !== 'update') {
        return;
      }
      ipcRenderer.send(DESKTOP_SHELL_RUNTIME_MAINTENANCE_STARTED_CHANNEL, { kind });
    },
    performRuntimeMaintenanceAction: async (request: unknown) => {
      const normalized = normalizeDesktopShellRuntimeActionRequest(request);
      if (!normalized || (normalized.action !== 'restart_runtime' && normalized.action !== 'upgrade_runtime')) {
        return normalizeDesktopShellRuntimeActionResponse(null);
      }
      return normalizeDesktopShellRuntimeActionResponse(
        await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, normalized),
      );
    },
    manageDesktopUpdate: async () => normalizeDesktopShellRuntimeActionResponse(
      await ipcRenderer.invoke(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL, { action: 'manage_desktop_update' }),
    ),
  });
}
