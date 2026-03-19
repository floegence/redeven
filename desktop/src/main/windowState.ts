import type { BrowserWindow, Rectangle } from 'electron';
import { screen } from 'electron';

import type { DesktopStateStore, DesktopWindowState } from './desktopStateStore';
import type { DesktopWindowSpec } from './windowSpec';

export type RestoredWindowBounds = Readonly<{
  x?: number;
  y?: number;
  width: number;
  height: number;
}>;

const MIN_VISIBLE_EDGE = 80;
const SAVE_DEBOUNCE_MS = 200;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function roundRect(rect: Rectangle): Rectangle {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function captureDesktopWindowState(win: Pick<BrowserWindow, 'isDestroyed' | 'isMaximized' | 'isFullScreen' | 'getBounds' | 'getNormalBounds'>): DesktopWindowState | null {
  if (win.isDestroyed()) {
    return null;
  }

  const useNormalBounds = win.isMaximized() || win.isFullScreen();
  const bounds = roundRect(useNormalBounds ? win.getNormalBounds() : win.getBounds());
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized(),
    full_screen: win.isFullScreen(),
  };
}

export function resolveRestoredWindowBounds(
  spec: DesktopWindowSpec,
  state: DesktopWindowState | null,
  workArea: Rectangle,
): RestoredWindowBounds {
  const fallbackWidth = Math.max(spec.minWidth, Math.min(spec.width, workArea.width));
  const fallbackHeight = Math.max(spec.minHeight, Math.min(spec.height, workArea.height));
  if (!state) {
    return {
      width: fallbackWidth,
      height: fallbackHeight,
    };
  }

  const width = clamp(Math.round(state.width), Math.min(spec.minWidth, workArea.width), workArea.width);
  const height = clamp(Math.round(state.height), Math.min(spec.minHeight, workArea.height), workArea.height);
  const maxX = workArea.x + Math.max(0, workArea.width - MIN_VISIBLE_EDGE);
  const maxY = workArea.y + Math.max(0, workArea.height - MIN_VISIBLE_EDGE);
  const minX = workArea.x - Math.max(0, width - MIN_VISIBLE_EDGE);
  const minY = workArea.y - Math.max(0, height - MIN_VISIBLE_EDGE);

  return {
    x: clamp(Math.round(state.x), minX, maxX),
    y: clamp(Math.round(state.y), minY, maxY),
    width,
    height,
  };
}

function workAreaForState(state: DesktopWindowState | null): Rectangle {
  if (state) {
    return screen.getDisplayMatching({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    }).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

export function restoreBrowserWindowBounds(
  spec: DesktopWindowSpec,
  store: DesktopStateStore,
  key: string,
): RestoredWindowBounds {
  return resolveRestoredWindowBounds(spec, store.getWindowState(key), workAreaForState(store.getWindowState(key)));
}

export function applyRestoredWindowState(win: Pick<BrowserWindow, 'isDestroyed' | 'maximize' | 'setFullScreen'>, state: DesktopWindowState | null): void {
  if (!state || win.isDestroyed()) {
    return;
  }
  if (state.full_screen) {
    win.setFullScreen(true);
    return;
  }
  if (state.maximized) {
    win.maximize();
  }
}

export function attachDesktopWindowStatePersistence(
  win: BrowserWindow,
  store: DesktopStateStore,
  key: string,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;

  const saveNow = () => {
    if (disposed || win.isDestroyed()) {
      return;
    }
    const state = captureDesktopWindowState(win);
    if (!state) {
      return;
    }
    store.setWindowState(key, state);
  };

  const scheduleSave = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSave = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    saveNow();
  };

  win.on('move', scheduleSave);
  win.on('resize', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('enter-full-screen', scheduleSave);
  win.on('leave-full-screen', scheduleSave);
  win.on('close', flushSave);

  return () => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    win.removeListener('move', scheduleSave);
    win.removeListener('resize', scheduleSave);
    win.removeListener('maximize', scheduleSave);
    win.removeListener('unmaximize', scheduleSave);
    win.removeListener('enter-full-screen', scheduleSave);
    win.removeListener('leave-full-screen', scheduleSave);
    win.removeListener('close', flushSave);
  };
}
