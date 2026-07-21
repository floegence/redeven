import type { BrowserWindow } from 'electron';

import { desktopWindowThemeSnapshotForShellTheme } from './desktopTheme';
import type { DesktopStateStore } from './desktopStateStore';
import { applyDesktopWindowTheme } from './windowChrome';
import {
  DESKTOP_SHELL_THEME_SELECTION_STATE_KEY,
  DESKTOP_THEME_SOURCE_STATE_KEY,
  isDesktopShellThemePresetForMode,
  normalizeDesktopShellThemeSelection,
  normalizeDesktopThemeSource,
  sameDesktopThemeSnapshot,
  type DesktopDarkShellThemePreset,
  type DesktopLightShellThemePreset,
  type DesktopResolvedTheme,
  type DesktopShellThemeSelection,
  type DesktopThemeSnapshot,
  type DesktopThemeSource,
} from '../shared/desktopTheme';
import { DESKTOP_THEME_UPDATED_CHANNEL } from '../shared/desktopThemeIPC';

interface DesktopThemeNativeThemeLike {
  shouldUseDarkColors: boolean;
  themeSource: string;
  on: (event: 'updated', listener: () => void) => void;
  off: (event: 'updated', listener: () => void) => void;
}

function resolveDesktopThemeSnapshot(
  source: DesktopThemeSource,
  shellThemes: DesktopShellThemeSelection,
  nativeTheme: DesktopThemeNativeThemeLike,
): DesktopThemeSnapshot {
  const resolvedTheme: DesktopResolvedTheme = source === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : source;
  const activeShellTheme = shellThemes[resolvedTheme];

  return {
    source,
    resolvedTheme,
    shellThemes,
    activeShellTheme,
    window: desktopWindowThemeSnapshotForShellTheme(activeShellTheme),
  };
}

export class DesktopThemeState {
  private initialized = false;
  private source: DesktopThemeSource = 'system';
  private shellThemes: DesktopShellThemeSelection = normalizeDesktopShellThemeSelection(null);
  private snapshot: DesktopThemeSnapshot;
  private readonly windows = new Set<BrowserWindow>();

  private readonly handleNativeThemeUpdated = () => {
    if (this.source !== 'system') {
      return;
    }
    if (this.refreshSnapshot()) {
      this.broadcastSnapshot();
    }
  };

  constructor(
    private readonly store: Pick<DesktopStateStore, 'getRendererItem' | 'setRendererItem'>,
    private readonly nativeTheme: DesktopThemeNativeThemeLike,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.snapshot = resolveDesktopThemeSnapshot('system', this.shellThemes, this.nativeTheme);
  }

  initialize(): DesktopThemeSnapshot {
    if (this.initialized) {
      return this.snapshot;
    }

    this.initialized = true;
    this.source = normalizeDesktopThemeSource(this.store.getRendererItem(DESKTOP_THEME_SOURCE_STATE_KEY), 'system');
    this.shellThemes = normalizeDesktopShellThemeSelection(
      this.store.getRendererItem(DESKTOP_SHELL_THEME_SELECTION_STATE_KEY),
    );
    this.nativeTheme.themeSource = this.source;
    this.snapshot = resolveDesktopThemeSnapshot(this.source, this.shellThemes, this.nativeTheme);
    this.nativeTheme.on('updated', this.handleNativeThemeUpdated);
    return this.snapshot;
  }

  dispose(): void {
    if (!this.initialized) {
      return;
    }
    this.nativeTheme.off('updated', this.handleNativeThemeUpdated);
    this.initialized = false;
  }

  getSnapshot(): DesktopThemeSnapshot {
    return this.initialize();
  }

  setSource(nextSource: unknown): DesktopThemeSnapshot {
    this.initialize();

    const normalized = normalizeDesktopThemeSource(nextSource, this.source);
    if (normalized === this.source) {
      return this.snapshot;
    }

    this.source = normalized;
    this.store.setRendererItem(DESKTOP_THEME_SOURCE_STATE_KEY, normalized);
    this.nativeTheme.themeSource = normalized;
    this.refreshSnapshot();
    this.broadcastSnapshot();
    return this.snapshot;
  }

  setShellTheme(mode: unknown, presetName: unknown): DesktopThemeSnapshot {
    this.initialize();

    if ((mode !== 'light' && mode !== 'dark')
      || !isDesktopShellThemePresetForMode(presetName, mode)) {
      return this.snapshot;
    }

    if (this.shellThemes[mode] === presetName) {
      return this.snapshot;
    }

    this.shellThemes = mode === 'light'
      ? {
          ...this.shellThemes,
          light: presetName as DesktopLightShellThemePreset,
        }
      : {
          ...this.shellThemes,
          dark: presetName as DesktopDarkShellThemePreset,
        };
    this.store.setRendererItem(
      DESKTOP_SHELL_THEME_SELECTION_STATE_KEY,
      JSON.stringify(this.shellThemes),
    );
    this.refreshSnapshot();
    this.broadcastSnapshot();
    return this.snapshot;
  }

  registerWindow(win: BrowserWindow): void {
    this.initialize();
    this.windows.add(win);
    this.applySnapshotToWindow(win);
    win.on('closed', () => {
      this.windows.delete(win);
    });
  }

  private refreshSnapshot(): boolean {
    const next = resolveDesktopThemeSnapshot(this.source, this.shellThemes, this.nativeTheme);
    if (sameDesktopThemeSnapshot(this.snapshot, next)) {
      return false;
    }
    this.snapshot = next;
    return true;
  }

  private applySnapshotToWindow(win: Pick<BrowserWindow, 'isDestroyed' | 'webContents' | 'setBackgroundColor' | 'setTitleBarOverlay'>): void {
    if (win.isDestroyed()) {
      return;
    }
    applyDesktopWindowTheme(win, this.snapshot.window, this.platform);
    win.webContents.send(DESKTOP_THEME_UPDATED_CHANNEL, this.snapshot);
  }

  private broadcastSnapshot(): void {
    for (const win of Array.from(this.windows)) {
      if (win.isDestroyed()) {
        this.windows.delete(win);
        continue;
      }
      this.applySnapshotToWindow(win);
    }
  }
}
