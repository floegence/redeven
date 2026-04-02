// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createDesktopThemeStorageAdapter } from './desktopTheme';

describe('desktopTheme storage adapter', () => {
  it('routes theme persistence through the desktop shell bridge', () => {
    const base = {
      getItem: vi.fn((key: string) => (key === 'alpha' ? 'one' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(() => ['alpha']),
    };
    const snapshots = [{ source: 'system' as const }, { source: 'dark' as const }];
    const bridge = {
      getSnapshot: vi.fn(() => snapshots[0] as never),
      setSource: vi.fn(() => snapshots[1] as never),
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
    expect(adapter.keys?.()).toEqual(['alpha', 'redeven-envapp:desktop-theme']);
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
