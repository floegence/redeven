import type { FloeStorageAdapter } from '@floegence/floe-webapp-core';
import { desktopRendererStorageScopeID } from './desktopSessionContext';
import { readDesktopHostBridge } from './desktopHostWindow';

export interface DesktopStateStorageBridge {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  keys: () => string[];
}

declare global {
  interface Window {
    redevenDesktopStateStorage?: DesktopStateStorageBridge;
  }
}

const fallbackMemoryStorage = new Map<string, string>();
let desktopBridgeWarningLogged = false;

function isStorageLike(value: unknown): value is Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Storage>;
  return typeof candidate.getItem === 'function'
    && typeof candidate.setItem === 'function'
    && typeof candidate.removeItem === 'function';
}

function listBrowserStorageKeys(storage: Storage): string[] {
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) {
        keys.push(key);
      }
    }
    return keys;
  }

  return Object.keys(storage).filter((key) => {
    try {
      return storage.getItem(key) !== null;
    } catch {
      return false;
    }
  });
}

function localStorageBridge(): DesktopStateStorageBridge | null {
  try {
    if (typeof localStorage === 'undefined' || !isStorageLike(localStorage)) {
      return null;
    }
    return {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
      keys: () => listBrowserStorageKeys(localStorage),
    };
  } catch {
    return null;
  }
}

function desktopBridge(): DesktopStateStorageBridge | null {
  const candidate = readDesktopHostBridge('redevenDesktopStateStorage', (value): value is DesktopStateStorageBridge => (
    !!value
    && typeof value === 'object'
    && typeof (value as DesktopStateStorageBridge).getItem === 'function'
    && typeof (value as DesktopStateStorageBridge).setItem === 'function'
    && typeof (value as DesktopStateStorageBridge).removeItem === 'function'
    && typeof (value as DesktopStateStorageBridge).keys === 'function'
  ));
  if (!candidate) {
    return null;
  }
  return candidate;
}

function looksLikeElectronRenderer(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return String(navigator.userAgent ?? '').includes('Electron');
}

function warnMissingDesktopBridge(): void {
  if (desktopBridgeWarningLogged || !looksLikeElectronRenderer()) {
    return;
  }
  desktopBridgeWarningLogged = true;
  console.warn(
    'Redeven Desktop state storage bridge is unavailable; falling back to browser storage. UI preferences may not persist across full restarts.'
  );
}

function fallbackMemoryStorageBridge(): DesktopStateStorageBridge {
  return {
    getItem: (key) => fallbackMemoryStorage.get(String(key ?? '')) ?? null,
    setItem: (key, value) => {
      fallbackMemoryStorage.set(String(key ?? ''), String(value ?? ''));
    },
    removeItem: (key) => {
      fallbackMemoryStorage.delete(String(key ?? ''));
    },
    keys: () => Array.from(fallbackMemoryStorage.keys()).sort((a, b) => a.localeCompare(b)),
  };
}

export function isDesktopStateStorageAvailable(): boolean {
  return desktopBridge() !== null;
}

export function resolveUIStorage(): DesktopStateStorageBridge {
  const bridge = desktopBridge();
  if (bridge) {
    return bridge;
  }

  warnMissingDesktopBridge();
  return localStorageBridge() ?? fallbackMemoryStorageBridge();
}

export function createUIStorageAdapter(): FloeStorageAdapter {
  const storage = resolveUIStorage();
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    keys: () => storage.keys(),
  };
}

export function readUIStorageItem(key: string): string | null {
  try {
    return resolveUIStorage().getItem(String(key ?? '')) ?? null;
  } catch {
    return null;
  }
}

export function writeUIStorageItem(key: string, value: string): void {
  try {
    resolveUIStorage().setItem(String(key ?? ''), String(value ?? ''));
  } catch {
    // ignore
  }
}

export function removeUIStorageItem(key: string): void {
  try {
    resolveUIStorage().removeItem(String(key ?? ''));
  } catch {
    // ignore
  }
}

export function readUIStorageJSON<T>(key: string, fallback: T): T {
  const raw = readUIStorageItem(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeUIStorageJSON(key: string, value: unknown): void {
  writeUIStorageItem(key, JSON.stringify(value));
}

export function rendererScopedUIStorageKey(key: string): string {
  const cleanKey = String(key ?? '').trim();
  if (cleanKey === '') {
    return '';
  }
  const rendererScopeID = desktopRendererStorageScopeID();
  if (rendererScopeID === '') {
    return cleanKey;
  }
  return `${cleanKey}:${rendererScopeID}`;
}

export function readRendererScopedUIStorageItem(key: string): string | null {
  return readUIStorageItem(rendererScopedUIStorageKey(key));
}

export function writeRendererScopedUIStorageItem(key: string, value: string): void {
  writeUIStorageItem(rendererScopedUIStorageKey(key), value);
}

export function removeRendererScopedUIStorageItem(key: string): void {
  removeUIStorageItem(rendererScopedUIStorageKey(key));
}

export function readRendererScopedUIStorageJSON<T>(key: string, fallback: T): T {
  return readUIStorageJSON(rendererScopedUIStorageKey(key), fallback);
}

export function writeRendererScopedUIStorageJSON(key: string, value: unknown): void {
  writeUIStorageJSON(rendererScopedUIStorageKey(key), value);
}
