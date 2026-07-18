import { describe, expect, it } from 'vitest';

import {
  buildLocalUIEnvAppEntryURL,
  isLoopbackHost,
  isSupportedLocalHostname,
  LOCAL_UI_ENV_APP_ENTRY_PATH,
  normalizeLocalUIBridgeURL,
  normalizeLocalUIBaseURL,
} from './localUIURL';

describe('localUIURL', () => {
  it('recognizes supported local hosts', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('192.168.1.11')).toBe(false);

    expect(isSupportedLocalHostname('localhost')).toBe(true);
    expect(isSupportedLocalHostname('192.168.1.11')).toBe(true);
    expect(isSupportedLocalHostname('example.com')).toBe(false);
  });

  it('normalizes a Local UI base URL to its origin root', () => {
    expect(normalizeLocalUIBaseURL('http://192.168.1.11:24000/_redeven_proxy/env/?foo=bar')).toBe('http://192.168.1.11:24000/');
    expect(normalizeLocalUIBaseURL('https://127.0.0.1:24000')).toBe('https://127.0.0.1:24000/');
  });

  it('builds the canonical Env App entry URL from any Local UI URL', () => {
    expect(LOCAL_UI_ENV_APP_ENTRY_PATH).toBe('/_redeven_proxy/env/');
    expect(buildLocalUIEnvAppEntryURL('http://192.168.1.11:24000/?ignored=1#x')).toBe('http://192.168.1.11:24000/_redeven_proxy/env/');
    expect(buildLocalUIEnvAppEntryURL('https://127.0.0.1:24000/_redeven_proxy/env/assets/')).toBe('https://127.0.0.1:24000/_redeven_proxy/env/');
  });

  it('rejects unsupported hosts and malformed URLs', () => {
    expect(() => normalizeLocalUIBaseURL('')).toThrow('Redeven URL is required.');
    expect(() => normalizeLocalUIBaseURL('192.168.1.11:24000')).toThrow('Redeven URL must be a valid absolute URL.');
    expect(() => normalizeLocalUIBaseURL('http://example.com:24000/')).toThrow('Redeven URL must use localhost or an IP literal.');
    expect(() => normalizeLocalUIBaseURL('http://user:pass@127.0.0.1:24000/')).toThrow('Redeven URL must not include embedded credentials.');
  });

  it('normalizes only canonical HTTP loopback bridge roots', () => {
    expect(normalizeLocalUIBridgeURL(' http://127.0.0.1:43123 ')).toBe('http://127.0.0.1:43123/');
    expect(normalizeLocalUIBridgeURL('http://127.0.0.2:43123/')).toBe('http://127.0.0.2:43123/');
    expect(normalizeLocalUIBridgeURL('http://[::1]:43123/')).toBe('http://[::1]:43123/');

    for (const raw of [
      '',
      'https://127.0.0.1:43123/',
      'http://localhost:43123/',
      'http://127.1:43123/',
      'http://100.126.191.114:43123/',
      'http://127.0.0.1/',
      'http://127.0.0.1:43123/env',
      'http://user:pass@127.0.0.1:43123/',
      'http://127.0.0.1:43123/?token=secret',
      'http://127.0.0.1:43123/#fragment',
    ]) {
      expect(() => normalizeLocalUIBridgeURL(raw)).toThrow();
    }
  });
});
