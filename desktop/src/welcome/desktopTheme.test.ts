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
  const dark = resolvedTheme === 'dark';
  return {
    source,
    resolvedTheme,
    shellThemes,
    activeShellTheme: shellThemes[resolvedTheme],
    window: { backgroundColor: '#ffffff' as const, symbolColor: '#000000' as const },
    semantic: {
      version: 1 as const,
      background: dark ? '#0E121B' as const : '#F4F1ED' as const,
      surface: dark ? '#121721' as const : '#FFFDFA' as const,
      muted: dark ? '#1B212D' as const : '#F1EFEC' as const,
      foreground: dark ? '#F9FAFB' as const : '#202A37' as const,
      mutedForeground: dark ? '#8596AD' as const : '#5A687C' as const,
      border: dark ? '#252B37' as const : '#D8D3CC' as const,
      primary: dark ? '#F9FAFB' as const : '#202A37' as const,
      primaryForeground: dark ? '#0E121B' as const : '#FFFDFA' as const,
      info: dark ? '#79B8FF' as const : '#245B9B' as const,
      success: dark ? '#72D39C' as const : '#287A4B' as const,
      warning: dark ? '#F0C36A' as const : '#835800' as const,
      error: dark ? '#FF8A82' as const : '#B42318' as const,
    },
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
