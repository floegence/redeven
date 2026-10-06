import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('redevenDesktopLauncher', {
  performAction: (request: unknown) => ipcRenderer.invoke('gateway-qualification:action', request),
});
