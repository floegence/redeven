import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DesktopThemeState } from './desktopThemeState';
import { DESKTOP_THEME_SOURCE_STATE_KEY } from '../shared/desktopTheme';
import { DESKTOP_THEME_UPDATED_CHANNEL } from '../shared/desktopThemeIPC';

class FakeNativeTheme extends EventEmitter {
  shouldUseDarkColors = false;
  themeSource = 'system';
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly setBackgroundColor = vi.fn();
  readonly setTitleBarOverlay = vi.fn();
  readonly webContents = {
    send: vi.fn(),
  };

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function createStore(initialSource: string | null = null) {
  const rendererStorage = new Map<string, string>();
  if (initialSource !== null) {
    rendererStorage.set(DESKTOP_THEME_SOURCE_STATE_KEY, initialSource);
  }
  return {
    getRendererItem: (key: string) => rendererStorage.get(key) ?? null,
    setRendererItem: (key: string, value: string) => {
      rendererStorage.set(key, value);
    },
    rendererStorage,
  };
}

describe('DesktopThemeState', () => {
  it('loads the persisted explicit theme source and resolves native colors from it', () => {
    const store = createStore('dark');
    const nativeTheme = new FakeNativeTheme();
    nativeTheme.shouldUseDarkColors = false;

    const state = new DesktopThemeState(store, nativeTheme, 'darwin');
    const snapshot = state.getSnapshot();

    expect(nativeTheme.themeSource).toBe('dark');
    expect(snapshot).toEqual({
      source: 'dark',
      resolvedTheme: 'dark',
      window: {
        backgroundColor: '#0e121b',
        symbolColor: '#f9fafb',
      },
    });
  });

  it('persists source changes and broadcasts native updates to registered windows', () => {
    const store = createStore('system');
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'linux');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.setBackgroundColor.mockClear();
    win.setTitleBarOverlay.mockClear();
    win.webContents.send.mockClear();

    const snapshot = state.setSource('dark');

    expect(store.rendererStorage.get(DESKTOP_THEME_SOURCE_STATE_KEY)).toBe('dark');
    expect(nativeTheme.themeSource).toBe('dark');
    expect(snapshot.source).toBe('dark');
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0e121b');
    expect(win.setTitleBarOverlay).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(DESKTOP_THEME_UPDATED_CHANNEL, snapshot);
  });

  it('rebroadcasts updated resolved theme when the OS theme changes under system mode', () => {
    const store = createStore('system');
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'darwin');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.setBackgroundColor.mockClear();
    win.webContents.send.mockClear();

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0e121b');
    expect(win.webContents.send).toHaveBeenCalledWith(DESKTOP_THEME_UPDATED_CHANNEL, {
      source: 'system',
      resolvedTheme: 'dark',
      window: {
        backgroundColor: '#0e121b',
        symbolColor: '#f9fafb',
      },
    });
  });

  it('ignores OS theme updates once the user selected an explicit theme', () => {
    const store = createStore('light');
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'darwin');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.setBackgroundColor.mockClear();
    win.webContents.send.mockClear();

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(win.setBackgroundColor).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
