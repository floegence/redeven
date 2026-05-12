import { describe, expect, it } from 'vitest';

import {
  DESKTOP_DASHBOARD_URL,
  normalizeDesktopShellOpenExternalURLRequest,
  normalizeDesktopShellOpenExternalURLResponse,
} from './desktopShellExternalURLIPC';

describe('desktopShellExternalURLIPC', () => {
  it('defines the semantic dashboard target for desktop brand navigation', () => {
    const dashboardURL = new URL(DESKTOP_DASHBOARD_URL);
    const publicInstallURL = new URL('https://redeven.com/install.sh');

    expect(dashboardURL.protocol).toBe(publicInstallURL.protocol);
    expect(dashboardURL.host).toBe(publicInstallURL.host);
    expect(dashboardURL.pathname).toBe('/dashboard');
  });

  it('accepts absolute http and https urls only', () => {
    expect(normalizeDesktopShellOpenExternalURLRequest({ url: 'http://127.0.0.1:43123/cs/demo/' })).toEqual({
      url: 'http://127.0.0.1:43123/cs/demo/',
    });
    expect(normalizeDesktopShellOpenExternalURLRequest({ url: 'https://example.com/path?q=1#hash' })).toEqual({
      url: 'https://example.com/path?q=1#hash',
    });
    expect(normalizeDesktopShellOpenExternalURLRequest({ url: '/cs/demo/' })).toBeNull();
    expect(normalizeDesktopShellOpenExternalURLRequest({ url: 'about:blank' })).toBeNull();
    expect(normalizeDesktopShellOpenExternalURLRequest({ url: 'file:///tmp/demo' })).toBeNull();
  });

  it('normalizes response payloads defensively', () => {
    expect(normalizeDesktopShellOpenExternalURLResponse({ ok: true })).toEqual({ ok: true, message: undefined });
    expect(normalizeDesktopShellOpenExternalURLResponse({ ok: false, message: 'blocked' })).toEqual({
      ok: false,
      message: 'blocked',
    });
    expect(normalizeDesktopShellOpenExternalURLResponse(null)).toEqual({
      ok: false,
      message: 'Desktop failed to open the system browser.',
    });
  });
});
