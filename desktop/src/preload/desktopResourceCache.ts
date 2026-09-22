/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_RESOURCE_CACHE_CHANNEL, type DesktopResourceCacheBridge } from '../shared/resourceCacheIPC';

export function bootstrapDesktopResourceCacheBridge(): void {
  const bridge: DesktopResourceCacheBridge = {
    get: key => ipcRenderer.invoke(DESKTOP_RESOURCE_CACHE_CHANNEL, { action: 'get', key }),
    set: (key, value) => ipcRenderer.invoke(DESKTOP_RESOURCE_CACHE_CHANNEL, { action: 'set', key, value }),
    remove: key => ipcRenderer.invoke(DESKTOP_RESOURCE_CACHE_CHANNEL, { action: 'remove', key }),
    list: () => ipcRenderer.invoke(DESKTOP_RESOURCE_CACHE_CHANNEL, { action: 'list' }),
  };
  contextBridge.exposeInMainWorld('redevenDesktopResourceCache', bridge);
}
