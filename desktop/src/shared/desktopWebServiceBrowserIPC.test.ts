import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopWebServiceBrowserAction,
  normalizeDesktopWebServiceBrowserActionResponse,
  normalizeDesktopWebServiceBrowserState,
} from './desktopWebServiceBrowserIPC';

describe('desktopWebServiceBrowserIPC', () => {
  it('normalizes navigation and toolbar actions', () => {
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'navigate', address: '  /docs?q=1  ' })).toEqual({
      action: 'navigate',
      address: '/docs?q=1',
    });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'back' })).toEqual({ action: 'back' });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'forward' })).toEqual({ action: 'forward' });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'reload' })).toEqual({ action: 'reload' });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'stop' })).toEqual({ action: 'stop' });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'toggle_devtools' })).toEqual({
      action: 'toggle_devtools',
    });
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'open_external' })).toEqual({
      action: 'open_external',
    });
  });

  it('rejects malformed or oversized actions', () => {
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'navigate', address: '' })).toBeNull();
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'navigate', address: 'x'.repeat(8_193) })).toBeNull();
    expect(normalizeDesktopWebServiceBrowserAction({ action: 'open-external' })).toBeNull();
  });

  it('normalizes renderer-facing state and closed failures', () => {
    expect(normalizeDesktopWebServiceBrowserState({
      address: ' https://example.test/app ',
      title: ' App ',
      loading: true,
      can_go_back: true,
      can_go_forward: false,
      devtools_open: true,
      error_message: ' ',
    })).toEqual({
      address: 'https://example.test/app',
      title: 'App',
      loading: true,
      can_go_back: true,
      can_go_forward: false,
      devtools_open: true,
    });
    expect(normalizeDesktopWebServiceBrowserActionResponse(null)).toEqual({
      ok: false,
      message: 'Desktop could not complete the browser action.',
    });
  });
});
