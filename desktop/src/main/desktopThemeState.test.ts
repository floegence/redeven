import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DesktopThemeState } from './desktopThemeState';
import { desktopSemanticPaletteForShellTheme } from './desktopTheme';
import {
  DESKTOP_SHELL_THEME_SELECTION_STATE_KEY,
  DESKTOP_THEME_SOURCE_STATE_KEY,
} from '../shared/desktopTheme';
import {
  DESKTOP_THEME_UPDATED_CHANNEL,
  desktopRendererThemeSnapshot,
} from '../shared/desktopThemeIPC';

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

function createStore(
  initialSource: string | null = null,
  initialSelection: string | null = null,
) {
  const rendererStorage = new Map<string, string>();
  if (initialSource !== null) {
    rendererStorage.set(DESKTOP_THEME_SOURCE_STATE_KEY, initialSource);
  }
  if (initialSelection !== null) {
    rendererStorage.set(DESKTOP_SHELL_THEME_SELECTION_STATE_KEY, initialSelection);
  }
  return {
    getRendererItem: (key: string) => rendererStorage.get(key) ?? null,
    setRendererItem: vi.fn((key: string, value: string) => {
      rendererStorage.set(key, value);
    }),
    rendererStorage,
  };
}

describe('DesktopThemeState', () => {
  it('migrates the existing source-only state to Classic presets without changing appearance', () => {
    const store = createStore('dark');
    const nativeTheme = new FakeNativeTheme();
    nativeTheme.shouldUseDarkColors = false;

    const state = new DesktopThemeState(store, nativeTheme, 'darwin');
    const snapshot = state.getSnapshot();

    expect(nativeTheme.themeSource).toBe('dark');
    expect(snapshot).toEqual({
      source: 'dark',
      resolvedTheme: 'dark',
      shellThemes: {
        version: 1,
        light: 'classic-light',
        dark: 'classic-dark',
      },
      activeShellTheme: 'classic-dark',
      window: {
        backgroundColor: '#0e121b',
        symbolColor: '#f9fafb',
      },
      semantic: desktopSemanticPaletteForShellTheme('classic-dark'),
    });
    expect(store.setRendererItem).not.toHaveBeenCalled();
  });

  it('loads a persisted per-mode selection and derives the active native colors', () => {
    const store = createStore('dark', JSON.stringify({
      version: 1,
      light: 'mist',
      dark: 'forest',
    }));
    const state = new DesktopThemeState(store, new FakeNativeTheme(), 'darwin');

    expect(state.getSnapshot()).toMatchObject({
      source: 'dark',
      resolvedTheme: 'dark',
      shellThemes: { version: 1, light: 'mist', dark: 'forest' },
      activeShellTheme: 'forest',
      window: {
        backgroundColor: '#0b1a17',
        symbolColor: '#edf6f1',
      },
      semantic: desktopSemanticPaletteForShellTheme('forest'),
    });
  });

  it('normalizes damaged and cross-mode persisted ids independently', () => {
    const store = createStore('light', JSON.stringify({
      version: 1,
      light: 'ocean',
      dark: 'forest',
    }));
    const state = new DesktopThemeState(store, new FakeNativeTheme(), 'darwin');

    expect(state.getSnapshot().shellThemes).toEqual({
      version: 1,
      light: 'classic-light',
      dark: 'forest',
    });
    expect(state.getSnapshot().activeShellTheme).toBe('classic-light');
  });

  it('persists shell selection and broadcasts the renderer-safe snapshot to every window', () => {
    const store = createStore('system');
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'linux');
    const firstWindow = new FakeWindow();
    const secondWindow = new FakeWindow();

    state.registerWindow(firstWindow as never);
    state.registerWindow(secondWindow as never);
    firstWindow.setBackgroundColor.mockClear();
    firstWindow.webContents.send.mockClear();
    secondWindow.setBackgroundColor.mockClear();
    secondWindow.webContents.send.mockClear();

    const snapshot = state.setShellTheme('light', 'mist');

    expect(snapshot.source).toBe('system');
    expect(snapshot.shellThemes).toEqual({
      version: 1,
      light: 'mist',
      dark: 'classic-dark',
    });
    expect(snapshot.activeShellTheme).toBe('mist');
    expect(snapshot.window).toEqual({
      backgroundColor: '#eef3f7',
      symbolColor: '#1f3442',
    });
    expect(JSON.parse(
      store.rendererStorage.get(DESKTOP_SHELL_THEME_SELECTION_STATE_KEY) ?? 'null',
    )).toEqual(snapshot.shellThemes);
    expect(firstWindow.setBackgroundColor).toHaveBeenCalledWith('#eef3f7');
    expect(secondWindow.setBackgroundColor).toHaveBeenCalledWith('#eef3f7');
    expect(firstWindow.webContents.send).toHaveBeenCalledWith(
      DESKTOP_THEME_UPDATED_CHANNEL,
      desktopRendererThemeSnapshot(snapshot),
    );
    expect(secondWindow.webContents.send).toHaveBeenCalledWith(
      DESKTOP_THEME_UPDATED_CHANNEL,
      desktopRendererThemeSnapshot(snapshot),
    );
  });

  it('remembers the inactive mode without changing the active preset', () => {
    const store = createStore('light');
    const state = new DesktopThemeState(store, new FakeNativeTheme(), 'darwin');

    const snapshot = state.setShellTheme('dark', 'ember');

    expect(snapshot.source).toBe('light');
    expect(snapshot.shellThemes.dark).toBe('ember');
    expect(snapshot.activeShellTheme).toBe('classic-light');
    expect(snapshot.window.backgroundColor).toBe('#f4f1ed');
  });

  it('switches active preset and native colors when the OS changes under system mode', () => {
    const store = createStore('system', JSON.stringify({
      version: 1,
      light: 'mist',
      dark: 'forest',
    }));
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'darwin');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.setBackgroundColor.mockClear();
    win.webContents.send.mockClear();

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(state.getSnapshot().activeShellTheme).toBe('forest');
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#0b1a17');
    expect(win.webContents.send).toHaveBeenCalledWith(
      DESKTOP_THEME_UPDATED_CHANNEL,
      desktopRendererThemeSnapshot(state.getSnapshot()),
    );
  });

  it('persists source changes while retaining both preset memories', () => {
    const store = createStore('system', JSON.stringify({
      version: 1,
      light: 'mist',
      dark: 'ember',
    }));
    const nativeTheme = new FakeNativeTheme();
    const state = new DesktopThemeState(store, nativeTheme, 'linux');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.setBackgroundColor.mockClear();
    win.webContents.send.mockClear();

    const snapshot = state.setSource('dark');

    expect(store.rendererStorage.get(DESKTOP_THEME_SOURCE_STATE_KEY)).toBe('dark');
    expect(nativeTheme.themeSource).toBe('dark');
    expect(snapshot.shellThemes).toEqual({ version: 1, light: 'mist', dark: 'ember' });
    expect(snapshot.activeShellTheme).toBe('ember');
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#1d1115');
    expect(win.webContents.send).toHaveBeenCalledWith(
      DESKTOP_THEME_UPDATED_CHANNEL,
      desktopRendererThemeSnapshot(snapshot),
    );
  });

  it('notifies shell document owners with the palette for every changed selection', () => {
    const store = createStore('light');
    const onSnapshotChanged = vi.fn();
    const state = new DesktopThemeState(
      store,
      new FakeNativeTheme(),
      'darwin',
      onSnapshotChanged,
    );

    state.setShellTheme('dark', 'forest');
    expect(onSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(onSnapshotChanged.mock.calls[0]?.[0].semantic).toEqual(
      desktopSemanticPaletteForShellTheme('classic-light'),
    );

    const snapshot = state.setShellTheme('light', 'mist');
    expect(onSnapshotChanged).toHaveBeenCalledTimes(2);
    expect(onSnapshotChanged).toHaveBeenCalledWith(snapshot);
    expect(snapshot.semantic).toEqual(desktopSemanticPaletteForShellTheme('mist'));
  });

  it('rejects invalid, cross-mode, and unchanged selections without side effects', () => {
    const store = createStore('light');
    const state = new DesktopThemeState(store, new FakeNativeTheme(), 'darwin');
    const win = new FakeWindow();

    state.registerWindow(win as never);
    store.setRendererItem.mockClear();
    win.setBackgroundColor.mockClear();
    win.webContents.send.mockClear();

    const initial = state.getSnapshot();
    expect(state.setShellTheme('light', 'ocean')).toBe(initial);
    expect(state.setShellTheme('future', 'mist')).toBe(initial);
    expect(state.setShellTheme('light', 'classic-light')).toBe(initial);
    expect(store.setRendererItem).not.toHaveBeenCalled();
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('ignores OS theme updates once the user selected an explicit source', () => {
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
