import type { FloeStorageAdapter } from '@floegence/floe-webapp-core';

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
  setSource: (source: DesktopThemeSource) => DesktopThemeSnapshot;
  setShellTheme: (mode: DesktopShellThemeMode, presetName: string) => DesktopThemeSnapshot;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}>;

type DesktopStateStorageBridge = Pick<FloeStorageAdapter, 'getItem' | 'setItem' | 'removeItem' | 'keys'>;

declare global {
  interface Window {
    redevenDesktopStateStorage?: DesktopStateStorageBridge;
  }
}

function normalizeDesktopThemeSource(value: unknown, fallback: DesktopThemeSource = 'system'): DesktopThemeSource {
  const candidate = String(value ?? '').trim();
  if (candidate === 'system' || candidate === 'light' || candidate === 'dark') {
    return candidate;
  }
  return fallback;
}

function parseStoredThemeSource(value: string | null): DesktopThemeSource | '' {
  if (value === null) {
    return '';
  }
  try {
    const raw = JSON.parse(value);
    const parsed = normalizeDesktopThemeSource(raw);
    return typeof raw === 'string' && raw.trim() === parsed ? parsed : '';
  } catch {
    const parsed = normalizeDesktopThemeSource(value);
    return value.trim() === parsed ? parsed : '';
  }
}

function parseStoredShellThemes(value: string | null): DesktopShellThemeSelection | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<DesktopShellThemeSelection> | null;
    if (
      !parsed
      || parsed.version !== 1
      || typeof parsed.light !== 'string'
      || !parsed.light.trim()
      || typeof parsed.dark !== 'string'
      || !parsed.dark.trim()
    ) {
      return null;
    }
    return {
      version: 1,
      light: parsed.light.trim(),
      dark: parsed.dark.trim(),
    };
  } catch {
    return null;
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
      if (key === persistedThemeKey) {
        const source = parseStoredThemeSource(value);
        if (source) {
          bridge.setSource(source);
        }
        return;
      }
      if (key === persistedShellThemeKey) {
        const selection = parseStoredShellThemes(value);
        if (selection) {
          const current = bridge.getSnapshot().shellThemes;
          if (selection.light !== current.light) {
            bridge.setShellTheme('light', selection.light);
          }
          if (selection.dark !== current.dark) {
            bridge.setShellTheme('dark', selection.dark);
          }
        }
        return;
      }
      base.setItem(key, value);
    },
    removeItem: (key) => {
      if (key === persistedThemeKey) {
        bridge.setSource('system');
        return;
      }
      if (key === persistedShellThemeKey) {
        bridge.setShellTheme('light', 'classic-light');
        bridge.setShellTheme('dark', 'classic-dark');
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

export function toggleDesktopTheme(
  resolvedTheme: DesktopResolvedTheme,
  bridge: DesktopThemeBridge | null,
  fallbackToggle: () => void,
): void {
  if (!bridge) {
    fallbackToggle();
    return;
  }
  bridge.setSource(resolvedTheme === 'light' ? 'dark' : 'light');
}
