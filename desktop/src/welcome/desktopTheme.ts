import type { FloeStorageAdapter } from '@floegence/floe-webapp-core';
import { BUILT_IN_SHELL_THEME_DEFAULTS } from '@floegence/floe-webapp-core/themes';

type DesktopThemeSource = 'system' | 'light' | 'dark';
type DesktopResolvedTheme = 'light' | 'dark';
type DesktopShellThemeMode = 'light' | 'dark';

type DesktopShellThemeSelection = Readonly<{
  version: 1;
  light: string;
  dark: string;
}>;

type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  shellThemes: DesktopShellThemeSelection;
  activeShellTheme: string;
  window: Readonly<{
    backgroundColor: string;
    symbolColor: string;
  }>;
}>;

type DesktopThemeBridge = Readonly<{
  getSnapshot: () => DesktopThemeSnapshot;
  setSource: (source: DesktopThemeSource) => Promise<DesktopThemeSnapshot>;
  setShellTheme: (mode: DesktopShellThemeMode, presetName: string) => Promise<DesktopThemeSnapshot>;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}>;

type DesktopStateStorageBridge = Pick<FloeStorageAdapter, 'getItem' | 'setItem' | 'removeItem' | 'keys'>;

declare global {
  interface Window {
    redevenDesktopStateStorage?: DesktopStateStorageBridge;
  }
}

export function desktopThemeBridge(): DesktopThemeBridge | null {
  const candidate = (window as Window & { redevenDesktopTheme?: DesktopThemeBridge }).redevenDesktopTheme;
  if (
    !candidate
    || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.setSource !== 'function'
    || typeof candidate.setShellTheme !== 'function'
    || typeof candidate.subscribe !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export function desktopStateStorageBridge(): DesktopStateStorageBridge | null {
  const candidate = window.redevenDesktopStateStorage;
  if (
    !candidate
    || typeof candidate.getItem !== 'function'
    || typeof candidate.setItem !== 'function'
    || typeof candidate.removeItem !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export function createDesktopThemeStorageAdapter(
  base: DesktopStateStorageBridge,
  namespace: string,
  themeStorageKey: string,
  bridge: DesktopThemeBridge | null,
): DesktopStateStorageBridge {
  if (!bridge) {
    return base;
  }

  const persistedThemeKey = `${namespace}-${themeStorageKey}`;
  const persistedShellThemeKey = `${persistedThemeKey}-shell-preset`;
  return {
    getItem: (key) => {
      if (key === persistedThemeKey) {
        return JSON.stringify(bridge.getSnapshot().source);
      }
      if (key === persistedShellThemeKey) {
        return JSON.stringify(bridge.getSnapshot().shellThemes);
      }
      return base.getItem(key);
    },
    setItem: (key, value) => {
      // Floe projects acknowledged Desktop state. Its debounced persistence must
      // never replay an older snapshot as a new main-process theme command.
      if (key === persistedThemeKey || key === persistedShellThemeKey) return;
      base.setItem(key, value);
    },
    removeItem: (key) => {
      if (key === persistedThemeKey) {
        void bridge.setSource('system').catch((error: unknown) => console.error('Could not reset Desktop appearance', error));
        return;
      }
      if (key === persistedShellThemeKey) {
        void Promise.all([
          bridge.setShellTheme('light', BUILT_IN_SHELL_THEME_DEFAULTS.light),
          bridge.setShellTheme('dark', BUILT_IN_SHELL_THEME_DEFAULTS.dark),
        ]).catch((error: unknown) => console.error('Could not reset Desktop appearance', error));
        return;
      }
      base.removeItem(key);
    },
    keys: () => {
      const keys = new Set(base.keys?.() ?? []);
      keys.add(persistedThemeKey);
      keys.add(persistedShellThemeKey);
      return Array.from(keys.keys()).sort((left, right) => left.localeCompare(right));
    },
  };
}

export async function toggleDesktopTheme(
  resolvedTheme: DesktopResolvedTheme,
  bridge: DesktopThemeBridge | null,
  fallbackToggle: () => void,
): Promise<void> {
  if (!bridge) {
    fallbackToggle();
    return;
  }
  await bridge.setSource(resolvedTheme === 'light' ? 'dark' : 'light');
}
