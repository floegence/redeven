import net from 'node:net';

export const LOCAL_UI_ENV_APP_ENTRY_PATH = '/_redeven_proxy/env/';

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function isSupportedLocalHostname(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase();
  return isLoopbackHost(host) || net.isIP(host) !== 0;
}

export function normalizeLocalUIBaseURL(rawURL: string): string {
  const cleanValue = String(rawURL ?? '').trim();
  if (!cleanValue) {
    throw new Error('Redeven URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(cleanValue);
  } catch {
    throw new Error('Redeven URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Redeven URL must start with http:// or https://.');
  }
  if (!isSupportedLocalHostname(parsed.hostname)) {
    throw new Error('Redeven URL must use localhost or an IP literal.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Redeven URL must not include embedded credentials.');
  }

  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function buildLocalUIEnvAppEntryURL(rawURL: string): string {
  const parsed = new URL(normalizeLocalUIBaseURL(rawURL));
  parsed.pathname = LOCAL_UI_ENV_APP_ENTRY_PATH;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function canonicalIPv4Loopback(hostname: string): boolean {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

export function normalizeLocalUIBridgeURL(rawURL: string): string {
  const cleanValue = String(rawURL ?? '').trim();
  const authorityMatch = cleanValue.match(/^http:\/\/(\[[^\]]+\]|[^/:?#]+):(\d+)(\/?)$/u);
  if (!authorityMatch) {
    throw new Error('Local UI bridge URL must be an HTTP loopback root URL with an explicit port.');
  }

  const rawHostname = String(authorityMatch[1] ?? '');
  const hostname = rawHostname.startsWith('[') && rawHostname.endsWith(']')
    ? rawHostname.slice(1, -1)
    : rawHostname;
  const isCanonicalLoopback = canonicalIPv4Loopback(hostname) || hostname === '::1';
  if (!isCanonicalLoopback || net.isIP(hostname) === 0) {
    throw new Error('Local UI bridge URL host must be a canonical loopback IP literal.');
  }

  const port = Number(authorityMatch[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('Local UI bridge URL must include a valid non-zero port.');
  }

  const parsed = new URL(cleanValue);
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Local UI bridge URL must be an HTTP loopback root URL without credentials, query, or fragment.');
  }
  return parsed.toString();
}
