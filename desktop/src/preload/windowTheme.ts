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
  type DesktopThemeSnapshot,
  type DesktopThemeSource,
} from '../shared/desktopTheme';
import {
  buildDesktopWindowChromeStyleText,
  DESKTOP_WINDOW_CHROME_STYLE_ID,
  type DesktopWindowChromeSnapshot,
} from '../shared/windowChromeContract';
import {
  resolveDesktopWindowChromeSnapshot,
} from '../shared/windowChromePlatform';

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
}

const listeners = new Set<(snapshot: DesktopThemeSnapshot) => void>();
let currentSnapshot = readDesktopThemeSnapshot();
const currentWindowChromeSnapshot = resolveDesktopWindowChromeSnapshot(process.platform);

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

function applyDesktopWindowChromeToDocument(): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.dataset.redevenDesktopWindowChromeMode = currentWindowChromeSnapshot.mode;
  root.dataset.redevenDesktopWindowControlsSide = currentWindowChromeSnapshot.controlsSide;
}

function ensureWindowChromeStyle(): void {
  if (!document.head || document.getElementById(DESKTOP_WINDOW_CHROME_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = DESKTOP_WINDOW_CHROME_STYLE_ID;
  style.textContent = buildDesktopWindowChromeStyleText(currentWindowChromeSnapshot);
  document.head.appendChild(style);
}

function syncCurrentDocument(snapshot: DesktopThemeSnapshot): void {
  applyDesktopThemeToDocument(snapshot);
  applyDesktopDocumentFallbackColors(snapshot);
  applyDesktopWindowChromeToDocument();
  ensureWindowChromeStyle();
}

function updateDesktopThemeSnapshot(snapshot: DesktopThemeSnapshot): DesktopThemeSnapshot {
  currentSnapshot = snapshot;
  syncCurrentDocument(snapshot);
  for (const listener of Array.from(listeners)) {
    listener(snapshot);
  }
  return currentSnapshot;
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

  syncCurrentDocument(currentSnapshot);
  document.addEventListener('readystatechange', () => {
    syncCurrentDocument(currentSnapshot);
  });
  window.addEventListener('DOMContentLoaded', () => {
    syncCurrentDocument(currentSnapshot);
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
  } satisfies DesktopWindowChromeBridge);
}
