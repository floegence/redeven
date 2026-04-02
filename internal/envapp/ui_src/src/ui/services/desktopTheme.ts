import type { FloeStorageAdapter } from '@floegence/floe-webapp-core';

export type DesktopThemeSource = 'system' | 'light' | 'dark';
export type DesktopResolvedTheme = 'light' | 'dark';

export type DesktopThemeSnapshot = Readonly<{
  source: DesktopThemeSource;
  resolvedTheme: DesktopResolvedTheme;
  window: Readonly<{
    backgroundColor: string;
    symbolColor: string;
  }>;
}>;

export type DesktopThemeBridge = Readonly<{
  getSnapshot: () => DesktopThemeSnapshot;
  setSource: (source: DesktopThemeSource) => DesktopThemeSnapshot;
  subscribe: (listener: (snapshot: DesktopThemeSnapshot) => void) => () => void;
}>;

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
    return normalizeDesktopThemeSource(JSON.parse(value));
  } catch {
    const parsed = normalizeDesktopThemeSource(value);
    return value.trim() === parsed ? parsed : '';
  }
}

export function desktopThemeBridge(): DesktopThemeBridge | null {
  const candidate = (window as Window & { redevenDesktopTheme?: DesktopThemeBridge }).redevenDesktopTheme;
  if (
    !candidate
    || typeof candidate.getSnapshot !== 'function'
    || typeof candidate.setSource !== 'function'
    || typeof candidate.subscribe !== 'function'
  ) {
    return null;
  }
  return candidate;
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
  return {
    getItem: (key) => {
      if (key === persistedThemeKey) {
        return JSON.stringify(bridge.getSnapshot().source);
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
      base.setItem(key, value);
    },
    removeItem: (key) => {
      if (key === persistedThemeKey) {
        bridge.setSource('system');
        return;
      }
      base.removeItem(key);
    },
    keys: () => {
      const keys = new Set(base.keys?.() ?? []);
      keys.add(persistedThemeKey);
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
