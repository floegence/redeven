import { isLoopbackHost, isSupportedLocalHostname } from './localUIURL';

function normalizeHTTPPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
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
    if (!isSupportedLocalHostname(allowed.hostname) || !isSupportedLocalHostname(candidate.hostname)) {
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
