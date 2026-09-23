import type { IncomingHttpHeaders } from 'node:http';

// Runtime owns the name, including the actual authority behind a Desktop
// bridge. Consumers validate the wire shape without inferring a local port.
export function isLocalAccessCookieName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^redeven_local_access_(?:http|https)_([1-9][0-9]{0,4})$/u.exec(value);
  return !!match && Number(match[1]) <= 65535;
}

export function localAccessCookieFromHeaders(headers: IncomingHttpHeaders): string {
  const values = headers['set-cookie'] ?? [];
  const cookies: string[] = [];
  for (const value of values) {
    const pair = value.split(';', 1)[0]!.trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (!isLocalAccessCookieName(pair.slice(0, separator))) continue;
    // A cookie value is opaque, but must remain a single safe request pair.
    if (!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/u.test(pair.slice(separator + 1))) {
      throw new Error('Runtime returned an invalid access cookie.');
    }
    cookies.push(pair);
  }
  if (cookies.length > 1) throw new Error('Runtime returned ambiguous access cookies.');
  return cookies[0] ?? '';
}
