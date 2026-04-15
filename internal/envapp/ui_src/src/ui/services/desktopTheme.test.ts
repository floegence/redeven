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
  it('resolves the desktop theme bridge from a same-origin parent window', () => {
    const bridge = {
      getSnapshot: vi.fn(() => ({ source: 'dark', resolvedTheme: 'dark', window: { backgroundColor: '#000', symbolColor: '#fff' } })),
      setSource: vi.fn(),
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
