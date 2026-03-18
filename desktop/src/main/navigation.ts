import net from 'node:net';

function normalizeHTTPPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isSupportedLocalHost(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase();
  return isLoopbackHost(host) || net.isIP(host) !== 0;
}

export function isAllowedAppNavigation(input: string, allowedBaseURL: string): boolean {
  try {
    const candidate = new URL(input);
    const allowed = new URL(allowedBaseURL);
    if ((candidate.protocol !== 'http:' && candidate.protocol !== 'https:') || (allowed.protocol !== 'http:' && allowed.protocol !== 'https:')) {
      return false;
    }
    if (normalizeHTTPPort(candidate) !== normalizeHTTPPort(allowed)) {
      return false;
    }
    if (!isSupportedLocalHost(allowed.hostname) || !isSupportedLocalHost(candidate.hostname)) {
      return false;
    }
    if (isLoopbackHost(allowed.hostname) && isLoopbackHost(candidate.hostname)) {
      return true;
    }
    return candidate.hostname === allowed.hostname;
  } catch {
    return false;
  }
}
