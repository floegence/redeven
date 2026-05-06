import { describe, expect, it } from 'vitest';

import { readDesktopHostBridge, resolveDesktopHostWindow } from './desktopHostWindow';

type FakeWindow = Window & {
  location: { origin: string };
  parent: Window;
  top: Window;
  redevenDesktopEmbeddedDragRegions?: unknown;
  redevenDesktopTheme?: unknown;
  redevenDesktopSessionContext?: unknown;
  redevenDesktopStateStorage?: unknown;
  redevenDesktopWindowChrome?: unknown;
};

function createFakeWindow(origin = 'https://env.example.invalid'): FakeWindow {
  const fake = {
    location: { origin },
  } as FakeWindow;
  fake.parent = fake;
  fake.top = fake;
  return fake;
}

describe('desktopHostWindow', () => {
  it('prefers desktop bridges on the current window', () => {
    const currentWindow = createFakeWindow();
    currentWindow.redevenDesktopTheme = { getSnapshot: () => ({}) };

    expect(resolveDesktopHostWindow(currentWindow)).toBe(currentWindow);
  });

  it('falls back to a same-origin parent window when the current frame has no bridges', () => {
    const currentWindow = createFakeWindow();
    const parentWindow = createFakeWindow();
    parentWindow.redevenDesktopStateStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      keys: () => [],
    };
    currentWindow.parent = parentWindow;
    currentWindow.top = parentWindow;

    expect(resolveDesktopHostWindow(currentWindow)).toBe(parentWindow);
  });

  it('ignores inaccessible or cross-origin parents and still resolves a same-origin top window', () => {
    const currentWindow = createFakeWindow();
    const topWindow = createFakeWindow();
    topWindow.redevenDesktopWindowChrome = {
      getSnapshot: () => ({
        mode: 'hidden-inset',
        controlsSide: 'left',
        titleBarHeight: 40,
        contentInsetStart: 84,
        contentInsetEnd: 16,
      }),
    };

    const crossOriginParent = {} as Window;
    Object.defineProperty(crossOriginParent, 'location', {
      get() {
        throw new Error('cross-origin');
      },
    });

    currentWindow.parent = crossOriginParent;
    currentWindow.top = topWindow;

    expect(resolveDesktopHostWindow(currentWindow)).toBe(topWindow);
  });

  it('reads the requested bridge from a later same-origin host when the current window only has a different bridge', () => {
    const currentWindow = createFakeWindow();
    currentWindow.redevenDesktopTheme = { getSnapshot: () => ({}) };

    const parentWindow = createFakeWindow();
    const sessionContextBridge = {
      getSnapshot: () => ({
        local_environment_id: 'local',
        renderer_storage_scope_id: 'local',
      }),
    };
    parentWindow.redevenDesktopSessionContext = sessionContextBridge;

    currentWindow.parent = parentWindow;
    currentWindow.top = parentWindow;

    expect(
      readDesktopHostBridge(
        'redevenDesktopSessionContext',
        (candidate): candidate is typeof sessionContextBridge => (
          !!candidate
          && typeof candidate === 'object'
          && typeof (candidate as { getSnapshot?: unknown }).getSnapshot === 'function'
        ),
        currentWindow,
      ),
    ).toBe(sessionContextBridge);
  });
});
