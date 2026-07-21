// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDesktopThemeStorageAdapter,
  desktopThemeBridge,
} from './desktopTheme';

const shellThemes = {
  version: 1,
  light: 'classic-light',
  dark: 'classic-dark',
} as const;

function snapshot(source: 'system' | 'light' | 'dark' = 'system') {
  const resolvedTheme = source === 'dark' ? 'dark' as const : 'light' as const;
  return {
    source,
    resolvedTheme,
    shellThemes,
    activeShellTheme: shellThemes[resolvedTheme],
    window: { backgroundColor: '#ffffff' as const, symbolColor: '#000000' as const },
  };
}

afterEach(() => {
  delete (window as Window & { redevenDesktopTheme?: unknown }).redevenDesktopTheme;
});

describe('Welcome desktop theme adapter', () => {
  it('requires the complete Desktop theme bridge contract', () => {
    const bridge = {
      getSnapshot: vi.fn(() => snapshot()),
      setSource: vi.fn(() => snapshot()),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    (window as Window & { redevenDesktopTheme?: typeof bridge }).redevenDesktopTheme = bridge;

    expect(desktopThemeBridge()).toBe(bridge);

    delete (bridge as Partial<typeof bridge>).setShellTheme;
    expect(desktopThemeBridge()).toBeNull();
  });

  it('routes source and versioned per-mode selection through Desktop', () => {
    const base = {
      getItem: vi.fn((key: string) => (key === 'other' ? 'value' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(() => ['other']),
    };
    const bridge = {
      getSnapshot: vi.fn(() => snapshot()),
      setSource: vi.fn(() => snapshot('dark')),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-desktop', 'theme', bridge);

    expect(adapter.getItem('redeven-desktop-theme')).toBe('"system"');
    expect(adapter.getItem('redeven-desktop-theme-shell-preset')).toBe(JSON.stringify(shellThemes));

    adapter.setItem('redeven-desktop-theme', '"dark"');
    adapter.setItem(
      'redeven-desktop-theme-shell-preset',
      JSON.stringify({ version: 1, light: 'mist', dark: 'nord' }),
    );

    expect(bridge.setSource).toHaveBeenCalledWith('dark');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(1, 'light', 'mist');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(2, 'dark', 'nord');
    expect(adapter.keys?.()).toEqual([
      'other',
      'redeven-desktop-theme',
      'redeven-desktop-theme-shell-preset',
    ]);
  });

  it('restores Desktop defaults when owned keys are removed', () => {
    const base = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const bridge = {
      getSnapshot: vi.fn(() => snapshot('dark')),
      setSource: vi.fn(() => snapshot()),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-desktop', 'theme', bridge);

    adapter.removeItem('redeven-desktop-theme');
    adapter.removeItem('redeven-desktop-theme-shell-preset');

    expect(bridge.setSource).toHaveBeenCalledWith('system');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(1, 'light', 'classic-light');
    expect(bridge.setShellTheme).toHaveBeenNthCalledWith(2, 'dark', 'classic-dark');
    expect(base.removeItem).not.toHaveBeenCalled();
  });

  it('ignores malformed owned payloads and delegates unrelated keys', () => {
    const base = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    const bridge = {
      getSnapshot: vi.fn(() => snapshot()),
      setSource: vi.fn(() => snapshot()),
      setShellTheme: vi.fn(() => snapshot()),
      subscribe: vi.fn(),
    };
    const adapter = createDesktopThemeStorageAdapter(base, 'redeven-desktop', 'theme', bridge);

    adapter.setItem('redeven-desktop-theme', '"unknown"');
    adapter.setItem('redeven-desktop-theme-shell-preset', '{"version":2}');
    adapter.setItem('layout', '{"sidebar":320}');
    adapter.removeItem('layout');

    expect(bridge.setSource).not.toHaveBeenCalled();
    expect(bridge.setShellTheme).not.toHaveBeenCalled();
    expect(base.setItem).toHaveBeenCalledWith('layout', '{"sidebar":320}');
    expect(base.removeItem).toHaveBeenCalledWith('layout');
  });
});
