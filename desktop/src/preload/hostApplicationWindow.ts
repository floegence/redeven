/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';
import {
  HOST_APPLICATION_WINDOW_ACTION_CHANNEL,
  HOST_APPLICATION_WINDOW_STATE_CHANNEL,
  isHostApplicationWindowAction,
  isHostApplicationWindowState,
  type HostApplicationWindowState,
} from '../shared/hostApplicationWindowIPC';

// This surface can control only its own native window. It receives no environment,
// filesystem, shell, session, or general Desktop bridge.
if (process.isMainFrame && location.pathname.endsWith('/_redeven_host_app/')) {
  contextBridge.exposeInMainWorld('redevenHostApplicationWindow', {
    request: (action: unknown): void => {
      if (isHostApplicationWindowAction(action)) ipcRenderer.send(HOST_APPLICATION_WINDOW_ACTION_CHANNEL, action);
    },
    subscribe: (listener: (state: HostApplicationWindowState) => void): (() => void) => {
      const receive = (_event: unknown, value: unknown): void => {
        if (isHostApplicationWindowState(value)) listener({ maximized: value.maximized, minimized: value.minimized });
      };
      ipcRenderer.on(HOST_APPLICATION_WINDOW_STATE_CHANNEL, receive);
      ipcRenderer.send(HOST_APPLICATION_WINDOW_ACTION_CHANNEL, 'state');
      return () => ipcRenderer.removeListener(HOST_APPLICATION_WINDOW_STATE_CHANNEL, receive);
    },
  });
}
