// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createUIStorageAdapter,
  rendererScopedUIStorageKey,
  isDesktopStateStorageAvailable,
  removeUIStorageItem,
  readUIStorageItem,
  readRendererScopedUIStorageItem,
  writeUIStorageItem,
  writeRendererScopedUIStorageItem,
} from './uiStorage';

const originalParent = window.parent;
const originalTop = window.top;

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
  delete window.redevenDesktopSessionContext;
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
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

  it('prefers a same-origin parent desktop bridge when embedded in a desktop boot frame', () => {
    const localStorageMock = createStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);

    const data = new Map<string, string>();
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopStateStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
        keys: () => Array.from(data.keys()),
      },
    } as unknown as Window;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: parentWindow,
    });
    Object.defineProperty(window, 'top', {
      configurable: true,
      value: parentWindow,
    });

    writeUIStorageItem('embedded', 'desktop');

    expect(readUIStorageItem('embedded')).toBe('desktop');
    expect(adapterKeys()).toEqual(['embedded']);
    expect(localStorageMock.getItem('embedded')).toBeNull();
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

  it('prefixes renderer-scoped keys with the Desktop session storage scope when available', () => {
    vi.stubGlobal('localStorage', createStorageMock());
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({
        local_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
        renderer_storage_scope_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      }),
    };

    writeRendererScopedUIStorageItem('files:lastPath', '/workspace/demo');

    expect(rendererScopedUIStorageKey('files:lastPath')).toBe(
      'files:lastPath:cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    );
    expect(readRendererScopedUIStorageItem('files:lastPath')).toBe('/workspace/demo');
  });
});
