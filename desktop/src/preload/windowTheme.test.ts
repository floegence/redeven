// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererSendSync = vi.fn();
let updatedListener: ((event: unknown, payload: unknown) => void) | null = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    on: ipcRendererOn,
    sendSync: ipcRendererSendSync,
  },
}));

function darkSnapshot() {
  return {
    source: 'system',
    resolvedTheme: 'dark',
    window: {
      backgroundColor: '#0e121b',
      symbolColor: '#f9fafb',
    },
  };
}

function lightSnapshot() {
  return {
    source: 'light',
    resolvedTheme: 'light',
    window: {
      backgroundColor: '#f3e5de',
      symbolColor: '#181311',
    },
  };
}

describe('bootstrapDesktopThemeBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    document.head.innerHTML = '';
    exposeInMainWorld.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererSendSync.mockReset();
    updatedListener = null;
    ipcRendererOn.mockImplementation((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (channel === 'redeven-desktop:theme-updated') {
        updatedListener = listener;
      }
    });
    ipcRendererSendSync.mockImplementation((channel: string, payload?: unknown) => {
      if (channel === 'redeven-desktop:theme-get-snapshot') {
        return darkSnapshot();
      }
      if (channel === 'redeven-desktop:theme-set-source') {
        return payload === 'light' ? lightSnapshot() : darkSnapshot();
      }
      return null;
    });
  });

  it('exposes the desktop theme bridge and applies the initial snapshot to the document', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.redevenDesktopWindowChromeMode).toBe('hidden-inset');
    expect(document.documentElement.dataset.redevenDesktopWindowControlsSide).toBe('left');

    const style = document.getElementById('redeven-desktop-window-chrome');
    expect(style).toBeTruthy();
    expect(style?.textContent).toContain('--redeven-desktop-titlebar-height: 40px;');
    expect(style?.textContent).toContain("[data-floe-shell-slot='top-bar']");
    expect(style?.textContent).toContain("[data-redeven-desktop-titlebar-no-drag='true']");

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    expect(bridge.getSnapshot()).toEqual(darkSnapshot());
  });

  it('updates the current document and subscribers when the main process broadcasts a new snapshot', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(darkSnapshot());

    updatedListener?.({}, lightSnapshot());

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(listener).toHaveBeenLastCalledWith(lightSnapshot());

    unsubscribe();
    updatedListener?.({}, darkSnapshot());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('sets the shell theme source synchronously through the bridge', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const [, bridge] = exposeInMainWorld.mock.calls[0] ?? [];
    const snapshot = bridge.setSource('light');

    expect(ipcRendererSendSync).toHaveBeenCalledWith('redeven-desktop:theme-set-source', 'light');
    expect(snapshot).toEqual(lightSnapshot());
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});
