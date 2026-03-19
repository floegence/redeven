// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createUIStorageAdapter,
  isDesktopStateStorageAvailable,
  removeUIStorageItem,
  readUIStorageItem,
  writeUIStorageItem,
} from './uiStorage';

function createStorageMock(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(String(key));
    },
    setItem(key: string, value: string) {
      data.set(String(key), String(value));
    },
  };
}

function adapterKeys(): string[] {
  return createUIStorageAdapter().keys?.() ?? [];
}

async function loadUIStorageModule() {
  vi.resetModules();
  return import('./uiStorage');
}

afterEach(() => {
  for (const key of adapterKeys()) {
    removeUIStorageItem(key);
  }
  vi.unstubAllGlobals();
  delete window.redevenDesktopStateStorage;
});

describe('uiStorage', () => {
  it('falls back to browser localStorage when no desktop bridge exists', () => {
    vi.stubGlobal('localStorage', createStorageMock());

    writeUIStorageItem('alpha', 'one');
    expect(readUIStorageItem('alpha')).toBe('one');
    expect(adapterKeys()).toContain('alpha');
    expect(isDesktopStateStorageAvailable()).toBe(false);
  });

  it('prefers the desktop bridge when it is available', () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);

    const data = new Map<string, string>();
    window.redevenDesktopStateStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
      keys: () => Array.from(data.keys()),
    };

    writeUIStorageItem('beta', 'two');
    localStorageMock.setItem('beta', 'local');

    expect(readUIStorageItem('beta')).toBe('two');
    expect(adapterKeys()).toEqual(['beta']);
    expect(localStorageMock.getItem('beta')).toBe('local');
    expect(isDesktopStateStorageAvailable()).toBe(true);
  });

  it('warns when an Electron renderer is missing the desktop bridge', async () => {
    vi.stubGlobal('localStorage', createStorageMock());
    vi.stubGlobal('navigator', { userAgent: 'RedevenDesktop Electron/41.0.0' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { readUIStorageItem: readItem, writeUIStorageItem: writeItem } = await loadUIStorageModule();
    writeItem('gamma', 'three');

    expect(readItem('gamma')).toBe('three');
    expect(warn).toHaveBeenCalledWith(
      'Redeven Desktop state storage bridge is unavailable; falling back to browser storage. UI preferences may not persist across full restarts.'
    );
  });
});
