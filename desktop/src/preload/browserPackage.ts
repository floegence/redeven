import { contextBridge, ipcRenderer } from 'electron';
import { BROWSER_PACKAGE_CHANNEL, BROWSER_PACKAGE_PROGRESS_CHANNEL, parseBrowserPackageRequest, parseBrowserPackageProgress, type BrowserPackageProgress } from '../shared/browserPackageIPC';
export function bootstrapBrowserPackageBridge(): void {
  contextBridge.exposeInMainWorld('redevenBrowserPackage', {
    request: (value: unknown) => {
      const request = parseBrowserPackageRequest(value);
      return request ? ipcRenderer.invoke(BROWSER_PACKAGE_CHANNEL, request) : Promise.resolve({ ok: false, error: 'unavailable' });
    },
    subscribe: (listener: (value: BrowserPackageProgress) => void) => {
      const receive = (_event: unknown, value: unknown) => { const progress = parseBrowserPackageProgress(value); if (progress) listener(progress); };
      ipcRenderer.on(BROWSER_PACKAGE_PROGRESS_CHANNEL, receive);
      return () => ipcRenderer.removeListener(BROWSER_PACKAGE_PROGRESS_CHANNEL, receive);
    },
  });
}
