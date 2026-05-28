// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererSendSync = vi.fn();
let updatedListener: ((event: unknown, payload: unknown) => void) | null = null;

function exposedBridge<T>(name: string): T {
  const bridge = exposeInMainWorld.mock.calls.find(([bridgeName]) => bridgeName === name)?.[1];
  if (!bridge) {
    throw new Error(`Missing exposed bridge: ${name}`);
  }
  return bridge as T;
}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    on: ipcRendererOn,
    sendSync: ipcRendererSendSync,
  },
}));

function englishSnapshot() {
  return {
    preference: 'system',
    resolved_locale: 'en-US',
    source: 'fallback',
    system_candidates: [],
  };
}

function chineseSnapshot() {
  return {
    preference: 'zh-CN',
    resolved_locale: 'zh-CN',
    source: 'explicit',
    system_candidates: ['en-US'],
  };
}

describe('bootstrapDesktopLanguageBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.title = 'Redeven Desktop';
    exposeInMainWorld.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererSendSync.mockReset();
    updatedListener = null;
    ipcRendererOn.mockImplementation((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (channel === 'redeven-desktop:language-updated') {
        updatedListener = listener;
      }
    });
    ipcRendererSendSync.mockImplementation((channel: string, payload?: unknown) => {
      if (channel === 'redeven-desktop:language-get-snapshot') {
        return englishSnapshot();
      }
      if (channel === 'redeven-desktop:language-set-preference') {
        return payload === 'zh-CN' ? chineseSnapshot() : englishSnapshot();
      }
      return null;
    });
  });

  it('exposes the desktop language bridge and applies the initial document language', async () => {
    const { bootstrapDesktopLanguageBridge } = await import('./desktopLanguage');

    bootstrapDesktopLanguageBridge();

    const bridge = exposedBridge<{
      getSnapshot: () => unknown;
      subscribe: (listener: (snapshot: unknown) => void) => () => void;
    }>('redevenDesktopLanguage');
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    expect(document.documentElement.lang).toBe('en-US');
    expect(document.documentElement.dir).toBe('ltr');
    expect(bridge.getSnapshot()).toEqual(englishSnapshot());
    expect(listener).toHaveBeenCalledWith(englishSnapshot());

    unsubscribe();
  });

  it('sets preference through synchronous IPC and notifies subscribers', async () => {
    const { bootstrapDesktopLanguageBridge } = await import('./desktopLanguage');

    bootstrapDesktopLanguageBridge();

    const bridge = exposedBridge<{
      setPreference: (preference: string) => unknown;
      subscribe: (listener: (snapshot: unknown) => void) => () => void;
    }>('redevenDesktopLanguage');
    const listener = vi.fn();
    bridge.subscribe(listener);

    const snapshot = bridge.setPreference('zh-CN');

    expect(ipcRendererSendSync).toHaveBeenCalledWith('redeven-desktop:language-set-preference', 'zh-CN');
    expect(snapshot).toEqual(chineseSnapshot());
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(listener).toHaveBeenLastCalledWith(chineseSnapshot());
  });

  it('updates subscribers when main broadcasts a new language snapshot', async () => {
    const { bootstrapDesktopLanguageBridge } = await import('./desktopLanguage');

    bootstrapDesktopLanguageBridge();

    const bridge = exposedBridge<{
      subscribe: (listener: (snapshot: unknown) => void) => () => void;
    }>('redevenDesktopLanguage');
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    updatedListener?.({}, chineseSnapshot());

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(listener).toHaveBeenLastCalledWith(chineseSnapshot());

    unsubscribe();
    updatedListener?.({}, englishSnapshot());
    expect(listener).not.toHaveBeenLastCalledWith(englishSnapshot());
  });
});
