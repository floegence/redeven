// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopThemeStorageAdapter, desktopThemeBridge } from './desktopTheme';

const originalParent = window.parent;
const originalTop = window.top;

function setWindowHierarchy(parent: Window, top: Window = parent): void {
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: top,
  });
}

afterEach(() => {
  delete (window as Window & { redevenDesktopTheme?: unknown }).redevenDesktopTheme;
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: originalParent,
  });
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: originalTop,
  });
});

describe('desktopTheme storage adapter', () => {
  const lightShellTheme = 'classic-light';
  const darkShellTheme = 'classic-dark';
  const snapshot = (source: 'system' | 'light' | 'dark' = 'system') => ({
    source,
    resolvedTheme: source === 'dark' ? 'dark' as const : 'light' as const,
    shellThemes: { version: 1 as const, light: lightShellTheme, dark: darkShellTheme },
    activeShellTheme: source === 'dark' ? darkShellTheme : lightShellTheme,
    window: { backgroundColor: '#ffffff', symbolColor: '#000000' },
  });

  it('resolves the desktop theme bridge from a same-origin parent window', () => {
    const bridge = {
      getSnapshot: vi.fn(() => snapshot('dark')),
      setSource: vi.fn(),
      setShellTheme: vi.fn(),
      subscribe: vi.fn(),
    };
    const parentWindow = {
      location: { origin: window.location.origin },
      redevenDesktopTheme: bridge,
    } as unknown as Window;

    setWindowHierarchy(parentWindow);

    expect(desktopThemeBridge()).toBe(bridge);
  });

  it('routes theme persistence through the desktop shell bridge', () => {
    const base = {
      getItem: vi.fn((key: string) => (key === 'alpha' ? 'one' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(() => ['alpha']),
    };
    const snapshots = [snapshot(), snapshot('dark')];
    const bridge = {
      getSnapshot: vi.fn(() => snapshots[0]),
      setSource: vi.fn(() => snapshots[1]),
      setShellTheme: vi.fn(() => snapshots[0]),
      subscribe: vi.fn(),
    };

    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-envapp:desktop', 'theme', bridge);

    expect(adapter.getItem('redeven-envapp:desktop-theme')).toBe('"system"');
    adapter.setItem('redeven-envapp:desktop-theme', '"dark"');
    adapter.removeItem('redeven-envapp:desktop-theme');

    expect(bridge.setSource).toHaveBeenNthCalledWith(1, 'dark');
    expect(bridge.setSource).toHaveBeenNthCalledWith(2, 'system');
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).not.toHaveBeenCalled();
    expect(adapter.keys?.()).toEqual([
      'alpha',
      'redeven-envapp:desktop-theme',
      'redeven-envapp:desktop-theme-shell-preset',
    ]);
  });

  it('routes versioned per-mode shell theme persistence through the desktop shell bridge', () => {
    const base = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(() => []),
    };
    const bridge = {
      getSnapshot: vi.fn(() => snapshot()),
      setSource: vi.fn(() => snapshot()),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-envapp:desktop', 'theme', bridge);
    const key = 'redeven-envapp:desktop-theme-shell-preset';

    expect(adapter.getItem(key)).toBe(JSON.stringify(snapshot().shellThemes));
    adapter.setItem(key, JSON.stringify({ version: 1, light: 'mist', dark: 'nord' }));

    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(1, 'light', 'mist');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(2, 'dark', 'nord');
    expect(base.setItem).not.toHaveBeenCalled();

    adapter.removeItem(key);
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(3, 'light', 'classic-light');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(4, 'dark', 'classic-dark');
  });

  it('ignores malformed desktop-owned theme payloads', () => {
    const base = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const bridge = {
      getSnapshot: vi.fn(() => snapshot()),
      setSource: vi.fn(() => snapshot()),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-envapp:desktop', 'theme', bridge);

    adapter.setItem('redeven-envapp:desktop-theme', '"unknown"');
    adapter.setItem('redeven-envapp:desktop-theme-shell-preset', '{"version":2}');

    expect(bridge.setSource).not.toHaveBeenCalled();
    expect(bridge.setShellTheme).not.toHaveBeenCalled();
  });

  it('falls back to the base storage adapter for non-theme keys', () => {
    const base = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(() => []),
    };

    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-envapp:desktop', 'theme', null);

    adapter.setItem('layout', '{"sidebar":320}');
    adapter.removeItem('layout');

    expect(base.setItem).toHaveBeenCalledWith('layout', '{"sidebar":320}');
    expect(base.removeItem).toHaveBeenCalledWith('layout');
  });
});
