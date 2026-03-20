import net from 'node:net';

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
