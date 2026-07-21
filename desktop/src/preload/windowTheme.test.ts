// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  desktopWindowChromeCSSVariables,
  resolveDesktopWindowChromeSnapshot,
} from '../shared/windowChromePlatform';

const exposeInMainWorld = vi.fn();
const ipcRendererOn = vi.fn();
const ipcRendererSendSync = vi.fn();
let updatedListener: ((event: unknown, payload: unknown) => void) | null = null;
let windowChromeUpdatedListener: ((event: unknown, payload: unknown) => void) | null = null;

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

function darkSnapshot() {
  return {
    source: 'system',
    resolvedTheme: 'dark',
    shellThemes: {
      version: 1,
      light: 'mist',
      dark: 'forest',
    },
    activeShellTheme: 'forest',
    window: {
      backgroundColor: '#0b1a17',
      symbolColor: '#edf6f1',
    },
  };
}

function lightSnapshot() {
  return {
    source: 'light',
    resolvedTheme: 'light',
    shellThemes: {
      version: 1,
      light: 'mist',
      dark: 'forest',
    },
    activeShellTheme: 'mist',
    window: {
      backgroundColor: '#eef3f7',
      symbolColor: '#1f3442',
    },
  };
}

function emberSnapshot() {
  return {
    ...darkSnapshot(),
    shellThemes: {
      version: 1,
      light: 'mist',
      dark: 'ember',
    },
    activeShellTheme: 'ember',
    window: {
      backgroundColor: '#1d1115',
      symbolColor: '#fff1f1',
    },
  };
}

describe('bootstrapDesktopThemeBridge', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    delete document.documentElement.dataset.floeShellTheme;
    document.head.innerHTML = '';
    exposeInMainWorld.mockReset();
    ipcRendererOn.mockReset();
    ipcRendererSendSync.mockReset();
    updatedListener = null;
    windowChromeUpdatedListener = null;
    ipcRendererOn.mockImplementation((channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (channel === 'redeven-desktop:theme-updated') {
        updatedListener = listener;
      }
      if (channel === 'redeven-desktop:window-chrome-updated') {
        windowChromeUpdatedListener = listener;
      }
    });
    ipcRendererSendSync.mockImplementation((channel: string, ...payload: unknown[]) => {
      if (channel === 'redeven-desktop:theme-get-snapshot') {
        return darkSnapshot();
      }
      if (channel === 'redeven-desktop:window-chrome-get-snapshot') {
        return resolveDesktopWindowChromeSnapshot(process.platform);
      }
      if (channel === 'redeven-desktop:theme-set-source') {
        return payload[0] === 'light' ? lightSnapshot() : darkSnapshot();
      }
      if (channel === 'redeven-desktop:theme-set-shell-theme') {
        return payload[0] === 'dark' && payload[1] === 'ember'
          ? emberSnapshot()
          : darkSnapshot();
      }
      return null;
    });
  });

  it('exposes the desktop theme bridge and applies the initial snapshot to the document', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');
    const windowChromeSnapshot = resolveDesktopWindowChromeSnapshot(process.platform);
    const windowChromeVars = desktopWindowChromeCSSVariables(process.platform);

    bootstrapDesktopThemeBridge();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.floeShellTheme).toBe('forest');
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-native-window-background')).toBe('#0b1a17');
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-native-window-symbol-color')).toBe('#edf6f1');
    expect(document.documentElement.style.getPropertyValue('background-color')).toBe('var(--background, #0b1a17)');
    expect(document.body.style.getPropertyValue('background-color')).toBe('var(--background, #0b1a17)');
    expect(document.documentElement.dataset.redevenDesktopWindowChromeMode).toBe(windowChromeSnapshot.mode);
    expect(document.documentElement.dataset.redevenDesktopWindowControlsSide).toBe(windowChromeSnapshot.controlsSide);

    const style = document.getElementById('redeven-desktop-window-chrome');
    expect(style).toBeTruthy();
    expect(style?.textContent).toContain(
      `--redeven-desktop-titlebar-height: ${windowChromeVars['--redeven-desktop-titlebar-height']};`,
    );
    expect(style?.textContent).toContain(
      `--redeven-desktop-titlebar-start-inset: ${windowChromeVars['--redeven-desktop-titlebar-start-inset']};`,
    );
    expect(style?.textContent).toContain(
      `--redeven-desktop-titlebar-end-inset: ${windowChromeVars['--redeven-desktop-titlebar-end-inset']};`,
    );
    expect(style?.textContent).toContain("[data-floe-shell-slot='top-bar']");
    expect(style?.textContent).toContain("[data-redeven-desktop-window-titlebar='true']");
    expect(style?.textContent).toContain("[data-redeven-desktop-window-titlebar-content='true']");
    expect(style?.textContent).toContain("[data-redeven-desktop-titlebar-no-drag='true']");

    const themeBridge = exposedBridge<{ getSnapshot: () => unknown }>('redevenDesktopTheme');
    const windowChromeBridge = exposedBridge<{ getSnapshot: () => unknown; subscribe: (listener: (snapshot: unknown) => void) => () => void }>('redevenDesktopWindowChrome');

    expect(themeBridge.getSnapshot()).toEqual(darkSnapshot());
    expect(windowChromeBridge.getSnapshot()).toEqual(windowChromeSnapshot);
    const windowChromeListener = vi.fn();
    const unsubscribe = windowChromeBridge.subscribe(windowChromeListener);
    expect(windowChromeListener).toHaveBeenCalledWith(windowChromeSnapshot);
    unsubscribe();
  });

  it('updates the current document and subscribers when the main process broadcasts a new snapshot', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const bridge = exposedBridge<{ subscribe: (listener: (snapshot: unknown) => void) => () => void }>('redevenDesktopTheme');
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(darkSnapshot());

    updatedListener?.({}, lightSnapshot());

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.dataset.floeShellTheme).toBe('mist');
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-native-window-background')).toBe('#eef3f7');
    expect(document.body.style.getPropertyValue('background-color')).toBe('var(--background, #eef3f7)');
    expect(listener).toHaveBeenLastCalledWith(lightSnapshot());

    updatedListener?.({}, lightSnapshot());
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    updatedListener?.({}, darkSnapshot());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify subscribers when the desktop theme snapshot is unchanged', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const bridge = exposedBridge<{
      setSource: (source: string) => unknown;
      subscribe: (listener: (snapshot: unknown) => void) => () => void;
    }>('redevenDesktopTheme');
    const listener = vi.fn();
    bridge.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);

    updatedListener?.({}, darkSnapshot());
    expect(listener).toHaveBeenCalledTimes(1);

    bridge.setSource('system');
    expect(listener).toHaveBeenCalledTimes(1);

    bridge.setSource('light');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(lightSnapshot());
  });

  it('sets the shell theme source synchronously through the bridge', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const bridge = exposedBridge<{ setSource: (source: string) => unknown }>('redevenDesktopTheme');
    const snapshot = bridge.setSource('light');

    expect(ipcRendererSendSync).toHaveBeenCalledWith('redeven-desktop:theme-set-source', 'light');
    expect(snapshot).toEqual(lightSnapshot());
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.dataset.floeShellTheme).toBe('mist');
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-native-window-background')).toBe('#eef3f7');
  });

  it('sets a shell preset synchronously through the bridge', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    const bridge = exposedBridge<{
      setShellTheme: (mode: string, presetName: string) => unknown;
    }>('redevenDesktopTheme');
    const snapshot = bridge.setShellTheme('dark', 'ember');

    expect(ipcRendererSendSync).toHaveBeenCalledWith(
      'redeven-desktop:theme-set-shell-theme',
      'dark',
      'ember',
    );
    expect(snapshot).toEqual(emberSnapshot());
    expect(document.documentElement.dataset.floeShellTheme).toBe('ember');
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-native-window-background')).toBe('#1d1115');
  });

  it('updates the current document when the main process broadcasts a new window chrome snapshot', async () => {
    const { bootstrapDesktopThemeBridge } = await import('./windowTheme');

    bootstrapDesktopThemeBridge();

    windowChromeUpdatedListener?.({}, {
      mode: 'hidden-inset',
      controlsSide: 'left',
      titleBarHeight: 40,
      contentInsetStart: 16,
      contentInsetEnd: 16,
    });

    expect(document.documentElement.dataset.redevenDesktopWindowChromeMode).toBe('hidden-inset');
    expect(document.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      '--redeven-desktop-titlebar-start-inset: 16px;',
    );
    expect(document.getElementById('redeven-desktop-window-chrome')?.textContent).toContain(
      '--redeven-desktop-titlebar-balance-inset: 16px;',
    );
  });
});
