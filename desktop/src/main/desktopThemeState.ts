import type { BrowserWindow } from 'electron';

import { desktopWindowThemeSnapshotForResolvedTheme } from './desktopTheme';
import type { DesktopStateStore } from './desktopStateStore';
import { applyDesktopWindowTheme } from './windowChrome';
import {
  DESKTOP_THEME_SOURCE_STATE_KEY,
  normalizeDesktopThemeSource,
  sameDesktopThemeSnapshot,
  type DesktopResolvedTheme,
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
  nativeTheme: DesktopThemeNativeThemeLike,
): DesktopThemeSnapshot {
  const resolvedTheme: DesktopResolvedTheme = source === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : source;

  return {
    source,
    resolvedTheme,
    window: desktopWindowThemeSnapshotForResolvedTheme(resolvedTheme),
  };
}

export class DesktopThemeState {
  private initialized = false;
  private source: DesktopThemeSource = 'system';
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
    this.snapshot = resolveDesktopThemeSnapshot('system', this.nativeTheme);
  }

  initialize(): DesktopThemeSnapshot {
    if (this.initialized) {
      return this.snapshot;
    }

    this.initialized = true;
    this.source = normalizeDesktopThemeSource(this.store.getRendererItem(DESKTOP_THEME_SOURCE_STATE_KEY), 'system');
    this.nativeTheme.themeSource = this.source;
    this.snapshot = resolveDesktopThemeSnapshot(this.source, this.nativeTheme);
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

  registerWindow(win: BrowserWindow): void {
    this.initialize();
    this.windows.add(win);
    this.applySnapshotToWindow(win);
    win.on('closed', () => {
      this.windows.delete(win);
    });
  }

  private refreshSnapshot(): boolean {
    const next = resolveDesktopThemeSnapshot(this.source, this.nativeTheme);
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
