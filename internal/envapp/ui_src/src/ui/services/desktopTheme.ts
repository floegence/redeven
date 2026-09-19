import type { FloeStorageAdapter } from '@floegence/floe-webapp-core';
import { BUILT_IN_SHELL_THEME_DEFAULTS } from '@floegence/floe-webapp-core/themes';
import { readDesktopHostBridge } from './desktopHostWindow';

export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';
export type DesktopShellThemeMode = 'light' | 'dark';

export type DesktopShellThemeSelection = Readonly<{
  version: 1;
  light: string;
  dark: string;
}>;

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  shellThemes: DesktopShellThemeSelection;
  activeShellTheme: string;
  window: Readonly<{
    backgroundColor: string;
    symbolColor: string;
  }>;
}>;

export type DesktopThemeBridge = Readonly<{
  getSnapshot: () => DesktopThemeSnapshot;
  setSource: (source: DesktopThemeSource) => Promise<DesktopThemeSnapshot>;
  setShellTheme: (mode: DesktopShellThemeMode, presetName: string) => Promise<DesktopThemeSnapshot>;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}>;

function isDesktopThemeBridge(candidate: unknown): candidate is DesktopThemeBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopThemeBridge>;
  return typeof bridge.getSnapshot === 'function'
    && typeof bridge.setSource === 'function'
    && typeof bridge.setShellTheme === 'function'
    && typeof bridge.subscribe === 'function';
}

export function desktopThemeBridge(): DesktopThemeBridge | null {
  return readDesktopHostBridge('redevenDesktopTheme', isDesktopThemeBridge);
}

export function createDesktopThemeStorageAdapter(
  base: FloeStorageAdapter,
  namespace: string,
  themeStorageKey: string,
  bridge: DesktopThemeBridge | null,
): FloeStorageAdapter {
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
