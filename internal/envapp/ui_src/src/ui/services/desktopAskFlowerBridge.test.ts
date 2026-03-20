// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestDesktopAskFlowerMainWindowHandoff,
  shouldRequireDesktopAskFlowerMainWindowHandoff,
  subscribeDesktopAskFlowerMainWindowHandoff,
} from './desktopAskFlowerBridge';

afterEach(() => {
  delete window.redevenDesktopAskFlowerHandoff;
  vi.unstubAllGlobals();
});

describe('desktopAskFlowerBridge', () => {
  it('returns false when the desktop bridge is unavailable', () => {
    expect(
      requestDesktopAskFlowerMainWindowHandoff({
        source: 'file_preview',
        path: '/workspace/demo.txt',
        selectionText: 'selected line',
      }),
    ).toBe(false);
  });

  it('requires the main-window handoff inside Electron renderers', () => {
    vi.stubGlobal('navigator', { userAgent: 'RedevenDesktop Electron/41.0.0' });

    expect(shouldRequireDesktopAskFlowerMainWindowHandoff()).toBe(true);
  });

  it('does not require the main-window handoff in standard browsers', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Test Browser' });

    expect(shouldRequireDesktopAskFlowerMainWindowHandoff()).toBe(false);
  });

  it('forwards normalized handoff requests to the desktop bridge', () => {
    const requestMainWindowHandoff = vi.fn();
    window.redevenDesktopAskFlowerHandoff = {
      requestMainWindowHandoff,
      onMainWindowHandoff: () => () => undefined,
    };

    const handled = requestDesktopAskFlowerMainWindowHandoff({
      source: 'file_preview',
      path: '/workspace/demo.txt/',
      selectionText: '  selected line  ',
    });

    expect(handled).toBe(true);
    expect(requestMainWindowHandoff).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });
  });

  it('subscribes to normalized main-window handoffs', () => {
    const listenerRegistry = new Set<(payload: unknown) => void>();
    window.redevenDesktopAskFlowerHandoff = {
      requestMainWindowHandoff: () => undefined,
      onMainWindowHandoff: (listener) => {
        listenerRegistry.add(listener as (payload: unknown) => void);
        return () => {
          listenerRegistry.delete(listener as (payload: unknown) => void);
        };
      },
    };

    const listener = vi.fn();
    const unsubscribe = subscribeDesktopAskFlowerMainWindowHandoff(listener);

    for (const handler of listenerRegistry) {
      handler({
        source: 'file_preview',
        path: '/workspace/demo.txt/',
        selectionText: '  selected line  ',
      });
    }

    expect(listener).toHaveBeenCalledWith({
      source: 'file_preview',
      path: '/workspace/demo.txt',
      selectionText: 'selected line',
    });

    listener.mockReset();
    unsubscribe();
    for (const handler of listenerRegistry) {
      handler({
        source: 'file_preview',
        path: '/workspace/next.txt',
        selectionText: '',
      });
    }
    expect(listener).not.toHaveBeenCalled();
  });
});
