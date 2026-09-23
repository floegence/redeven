import { describe, expect, it } from 'vitest';
import { isLocalAccessCookieName, localAccessCookieFromHeaders } from './localAccessCookie';

describe('Runtime-issued access cookies', () => {
  it('preserves the Runtime name and value without inferring the forwarded port', () => {
    expect(localAccessCookieFromHeaders({ 'set-cookie': [
      'redeven_auth_challenge_https_443=challenge; HttpOnly',
      'redeven_local_access_https_443=opaque-runtime-token; Path=/; Secure; HttpOnly',
    ] })).toBe('redeven_local_access_https_443=opaque-runtime-token');
  });

  it('does not restore the retired cookie contract', () => {
    expect(localAccessCookieFromHeaders({ 'set-cookie': ['redeven_local_access=obsolete; Path=/'] })).toBe('');
    expect(localAccessCookieFromHeaders({})).toBe('');
    expect(localAccessCookieFromHeaders({ 'set-cookie': ['redeven_local_access_http_801'] })).toBe('');
  });

  it.each(['redeven_local_access', 'redeven_local_access_http_0', 'redeven_local_access_http_080', 'redeven_local_access_https_65536', 'unrelated_http_80'])('rejects an invalid name: %s', name => {
    expect(isLocalAccessCookieName(name)).toBe(false);
  });

  it('rejects ambiguous or unsafe credentials', () => {
    expect(() => localAccessCookieFromHeaders({ 'set-cookie': [
      'redeven_local_access_http_80=a', 'redeven_local_access_https_443=b',
    ] })).toThrow('ambiguous');
    expect(() => localAccessCookieFromHeaders({ 'set-cookie': ['redeven_local_access_http_80=a\r\nInjected: value'] })).toThrow('invalid');
  });
});
