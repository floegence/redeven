/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_THEME_GET_SNAPSHOT_CHANNEL,
  DESKTOP_THEME_SET_SOURCE_CHANNEL,
  DESKTOP_THEME_UPDATED_CHANNEL,
  normalizeDesktopThemeSnapshot,
} from '../shared/desktopThemeIPC';
import {
  normalizeDesktopThemeSource,
  sameDesktopThemeSnapshot,
  type DesktopThemeSnapshot,
  type DesktopThemeSource,
} from '../shared/desktopTheme';
import {
  buildDesktopWindowChromeStyleText,
  DESKTOP_WINDOW_CHROME_STYLE_ID,
  normalizeDesktopWindowChromeSnapshot,
  type DesktopWindowChromeSnapshot,
} from '../shared/windowChromeContract';
import {
  resolveDesktopWindowChromeSnapshot,
} from '../shared/windowChromePlatform';
import {
  DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL,
  DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL,
} from '../shared/windowChromeIPC';

declare global {
  interface Window {
    redevenDesktopTheme?: DesktopThemeBridge;
    redevenDesktopWindowChrome?: DesktopWindowChromeBridge;
  }
}

export interface DesktopThemeBridge {
  getSnapshot: () => DesktopThemeSnapshot;
  setSource: (source: DesktopThemeSource) => DesktopThemeSnapshot;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}

export interface DesktopWindowChromeBridge {
  getSnapshot: () => DesktopWindowChromeSnapshot;
  subscribe: (listener: (snapshot: DesktopWindowChromeSnapshot) => void) => () => void;
}

const listeners = new Set<(snapshot: DesktopThemeSnapshot) => void>();
const windowChromeListeners = new Set<(snapshot: DesktopWindowChromeSnapshot) => void>();
let currentSnapshot = readDesktopThemeSnapshot();
let currentWindowChromeSnapshot = readDesktopWindowChromeSnapshot();

function fallbackDesktopThemeSnapshot(): DesktopThemeSnapshot {
  return {
    source: 'system',
    resolvedTheme: 'light',
    window: {
      backgroundColor: '#f0eeea',
      symbolColor: '#141f2e',
    },
  };
}

function readDesktopThemeSnapshot(): DesktopThemeSnapshot {
  const snapshot = normalizeDesktopThemeSnapshot(ipcRenderer.sendSync(DESKTOP_THEME_GET_SNAPSHOT_CHANNEL));
  return snapshot ?? fallbackDesktopThemeSnapshot();
}

function readDesktopWindowChromeSnapshot(): DesktopWindowChromeSnapshot {
  const snapshot = normalizeDesktopWindowChromeSnapshot(ipcRenderer.sendSync(DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL));
  return snapshot ?? resolveDesktopWindowChromeSnapshot(process.platform);
}

function applyDesktopThemeToDocument(snapshot: DesktopThemeSnapshot): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.classList.remove('light', 'dark');
  root.classList.add(snapshot.resolvedTheme);
  root.style.colorScheme = snapshot.resolvedTheme;
}

function applyDesktopDocumentFallbackColors(snapshot: DesktopThemeSnapshot): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  const background = `var(--background, ${snapshot.window.backgroundColor})`;
  const foreground = `var(--foreground, ${snapshot.window.symbolColor})`;
  root.style.setProperty('--redeven-desktop-native-window-background', snapshot.window.backgroundColor);
  root.style.setProperty('--redeven-desktop-native-window-symbol-color', snapshot.window.symbolColor);
  root.style.backgroundColor = background;
  root.style.color = foreground;

  if (document.body) {
    document.body.style.backgroundColor = background;
    document.body.style.color = foreground;
  }
}

function applyDesktopWindowChromeToDocument(snapshot: DesktopWindowChromeSnapshot): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.dataset.redevenDesktopWindowChromeMode = snapshot.mode;
  root.dataset.redevenDesktopWindowControlsSide = snapshot.controlsSide;
}

function ensureWindowChromeStyle(snapshot: DesktopWindowChromeSnapshot): void {
  if (!document.head) {
    return;
  }
  let style = document.getElementById(DESKTOP_WINDOW_CHROME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = DESKTOP_WINDOW_CHROME_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = buildDesktopWindowChromeStyleText(snapshot);
}

function syncCurrentDocument(snapshot: DesktopThemeSnapshot, windowChromeSnapshot: DesktopWindowChromeSnapshot): void {
  applyDesktopThemeToDocument(snapshot);
  applyDesktopDocumentFallbackColors(snapshot);
  applyDesktopWindowChromeToDocument(windowChromeSnapshot);
  ensureWindowChromeStyle(windowChromeSnapshot);
}

function updateDesktopThemeSnapshot(snapshot: DesktopThemeSnapshot): DesktopThemeSnapshot {
  if (sameDesktopThemeSnapshot(currentSnapshot, snapshot)) {
    return currentSnapshot;
  }
  currentSnapshot = snapshot;
  syncCurrentDocument(snapshot, currentWindowChromeSnapshot);
  for (const listener of Array.from(listeners)) {
    listener(snapshot);
  }
  return currentSnapshot;
}

function updateDesktopWindowChromeSnapshot(snapshot: DesktopWindowChromeSnapshot): DesktopWindowChromeSnapshot {
  currentWindowChromeSnapshot = snapshot;
  syncCurrentDocument(currentSnapshot, snapshot);
  for (const listener of Array.from(windowChromeListeners)) {
    listener(snapshot);
  }
  return currentWindowChromeSnapshot;
}

function setDesktopThemeSource(source: unknown): DesktopThemeSnapshot {
  const nextSource = normalizeDesktopThemeSource(source, currentSnapshot.source);
  const nextSnapshot = normalizeDesktopThemeSnapshot(ipcRenderer.sendSync(DESKTOP_THEME_SET_SOURCE_CHANNEL, nextSource));
  if (!nextSnapshot) {
    return currentSnapshot;
  }
  return updateDesktopThemeSnapshot(nextSnapshot);
}

function installDesktopThemeEventBridge(): void {
  ipcRenderer.on(DESKTOP_THEME_UPDATED_CHANNEL, (_event, payload) => {
    const snapshot = normalizeDesktopThemeSnapshot(payload);
    if (!snapshot) {
      return;
    }
    updateDesktopThemeSnapshot(snapshot);
  });

  ipcRenderer.on(DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL, (_event, payload) => {
    const snapshot = normalizeDesktopWindowChromeSnapshot(payload);
    if (!snapshot) {
      return;
    }
    updateDesktopWindowChromeSnapshot(snapshot);
  });

  syncCurrentDocument(currentSnapshot, currentWindowChromeSnapshot);
  document.addEventListener('readystatechange', () => {
    syncCurrentDocument(currentSnapshot, currentWindowChromeSnapshot);
  });
  window.addEventListener('DOMContentLoaded', () => {
    syncCurrentDocument(currentSnapshot, currentWindowChromeSnapshot);
  }, { once: true });
}

export function bootstrapDesktopThemeBridge(): void {
  installDesktopThemeEventBridge();

  const bridge: DesktopThemeBridge = {
    getSnapshot: () => currentSnapshot,
    setSource: (source) => setDesktopThemeSource(source),
    subscribe: (listener) => {
      if (typeof listener !== 'function') {
        return () => undefined;
      }
      listeners.add(listener);
      listener(currentSnapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  contextBridge.exposeInMainWorld('redevenDesktopTheme', bridge);
  contextBridge.exposeInMainWorld('redevenDesktopWindowChrome', {
    getSnapshot: () => currentWindowChromeSnapshot,
    subscribe: (listener) => {
      if (typeof listener !== 'function') {
        return () => undefined;
      }
      windowChromeListeners.add(listener);
      listener(currentWindowChromeSnapshot);
      return () => {
        windowChromeListeners.delete(listener);
      };
    },
  } satisfies DesktopWindowChromeBridge);
}
