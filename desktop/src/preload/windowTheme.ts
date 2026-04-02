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
import { desktopWindowTitleBarInsetCSSValue } from '../shared/windowChromePlatform';

declare global {
  interface Window {
    redevenDesktopTheme?: DesktopThemeBridge;
  }
}

export interface DesktopThemeBridge {
  getSnapshot: () => DesktopThemeSnapshot;
  setSource: (source: DesktopThemeSource) => DesktopThemeSnapshot;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}

const WINDOW_CHROME_STYLE_ID = 'redeven-desktop-window-chrome';
const WINDOW_CHROME_STYLE_TEXT = `
body > #root {
  box-sizing: border-box;
  padding-top: ${desktopWindowTitleBarInsetCSSValue(process.platform)};
}
`;

const listeners = new Set<(snapshot: DesktopThemeSnapshot) => void>();
let currentSnapshot = readDesktopThemeSnapshot();

function fallbackDesktopThemeSnapshot(): DesktopThemeSnapshot {
  return {
    source: 'system',
    resolvedTheme: 'light',
    window: {
      backgroundColor: '#f3e5de',
      symbolColor: '#181311',
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

function ensureWindowChromeStyle(): void {
  if (!document.head || document.getElementById(WINDOW_CHROME_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = WINDOW_CHROME_STYLE_ID;
  style.textContent = WINDOW_CHROME_STYLE_TEXT;
  document.head.appendChild(style);
}

function syncCurrentDocument(snapshot: DesktopThemeSnapshot): void {
  applyDesktopThemeToDocument(snapshot);
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
}
