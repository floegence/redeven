/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_LANGUAGE_GET_SNAPSHOT_CHANNEL,
  DESKTOP_LANGUAGE_SET_PREFERENCE_CHANNEL,
  DESKTOP_LANGUAGE_UPDATED_CHANNEL,
  normalizeDesktopLanguageSnapshot,
} from '../shared/desktopLanguageIPC';
import {
  normalizeRedevenLocalePreference,
  sameRedevenLanguageSnapshot,
  type RedevenLanguageSnapshot,
  type RedevenLocalePreference,
} from '../shared/i18n/desktopLanguage';

declare global {
  interface Window {
    redevenDesktopLanguage?: DesktopLanguageBridge;
  }
}

export interface DesktopLanguageBridge {
  getSnapshot: () => RedevenLanguageSnapshot;
  setPreference: (preference: RedevenLocalePreference) => RedevenLanguageSnapshot;
  subscribe: (listener: (snapshot: RedevenLanguageSnapshot) => void) => () => void;
}

const listeners = new Set<(snapshot: RedevenLanguageSnapshot) => void>();
let currentSnapshot = readDesktopLanguageSnapshot();

function fallbackDesktopLanguageSnapshot(): RedevenLanguageSnapshot {
  return {
    preference: 'system',
    resolved_locale: 'en-US',
    source: 'fallback',
    system_candidates: [],
  };
}

function readDesktopLanguageSnapshot(): RedevenLanguageSnapshot {
  const snapshot = normalizeDesktopLanguageSnapshot(ipcRenderer.sendSync(DESKTOP_LANGUAGE_GET_SNAPSHOT_CHANNEL));
  return snapshot ?? fallbackDesktopLanguageSnapshot();
}

function applyDesktopLanguageToDocument(snapshot: RedevenLanguageSnapshot): void {
  const root = document.documentElement;
  if (!root) {
    return;
  }
  root.lang = snapshot.resolved_locale;
  root.dir = 'ltr';
}

function updateDesktopLanguageSnapshot(snapshot: RedevenLanguageSnapshot): RedevenLanguageSnapshot {
  if (sameRedevenLanguageSnapshot(currentSnapshot, snapshot)) {
    return currentSnapshot;
  }
  currentSnapshot = snapshot;
  applyDesktopLanguageToDocument(snapshot);
  for (const listener of Array.from(listeners)) {
    listener(snapshot);
  }
  return currentSnapshot;
}

function setDesktopLanguagePreference(preference: unknown): RedevenLanguageSnapshot {
  const nextPreference = normalizeRedevenLocalePreference(preference, currentSnapshot.preference);
  const nextSnapshot = normalizeDesktopLanguageSnapshot(
    ipcRenderer.sendSync(DESKTOP_LANGUAGE_SET_PREFERENCE_CHANNEL, nextPreference),
  );
  if (!nextSnapshot) {
    return currentSnapshot;
  }
  return updateDesktopLanguageSnapshot(nextSnapshot);
}

function installDesktopLanguageEventBridge(): void {
  ipcRenderer.on(DESKTOP_LANGUAGE_UPDATED_CHANNEL, (_event, payload) => {
    const snapshot = normalizeDesktopLanguageSnapshot(payload);
    if (!snapshot) {
      return;
    }
    updateDesktopLanguageSnapshot(snapshot);
  });

  applyDesktopLanguageToDocument(currentSnapshot);
  document.addEventListener('readystatechange', () => {
    applyDesktopLanguageToDocument(currentSnapshot);
  });
  window.addEventListener('DOMContentLoaded', () => {
    applyDesktopLanguageToDocument(currentSnapshot);
  }, { once: true });
}

export function bootstrapDesktopLanguageBridge(): void {
  installDesktopLanguageEventBridge();

  const bridge: DesktopLanguageBridge = {
    getSnapshot: () => currentSnapshot,
    setPreference: (preference) => setDesktopLanguagePreference(preference),
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

  contextBridge.exposeInMainWorld('redevenDesktopLanguage', bridge);
}
