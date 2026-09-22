/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';
import { desktopWindowChromeCSSVariables, normalizeDesktopWindowChromeSnapshot } from '../shared/windowChromeContract';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
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
  // Geometry is presentation-only. Apply it in this trusted bootstrap document,
  // never inside the remote application iframe or through a general shell bridge.
  let chrome = resolveDesktopWindowChromeSnapshot(process.platform);
  const applyChrome = (): void => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.redevenHostApplicationChrome = 'true';
    for (const [key, value] of Object.entries(desktopWindowChromeCSSVariables(chrome))) root.style.setProperty(key, value);
  };
  ipcRenderer.on(HOST_APPLICATION_WINDOW_STATE_CHANNEL, (_event, value: unknown) => {
    if (!isHostApplicationWindowState(value)) return;
    const next = normalizeDesktopWindowChromeSnapshot((value as unknown as Record<string, unknown>).chrome);
    if (next) { chrome = next; applyChrome(); }
  });
  applyChrome();
  document.addEventListener('readystatechange', applyChrome);
  ipcRenderer.send(HOST_APPLICATION_WINDOW_ACTION_CHANNEL, 'state');
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
