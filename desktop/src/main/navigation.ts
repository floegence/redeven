function normalizeHTTPPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function isAllowedAppNavigation(input: string, allowedBaseURL: string): boolean {
  try {
    const candidate = new URL(input);
    const allowed = new URL(allowedBaseURL);
    if ((candidate.protocol !== 'http:' && candidate.protocol !== 'https:') || (allowed.protocol !== 'http:' && allowed.protocol !== 'https:')) {
      return false;
    }
    if (!isLoopbackHost(candidate.hostname)) {
      return false;
    }
    return normalizeHTTPPort(candidate) === normalizeHTTPPort(allowed);
  } catch {
    return false;
  }
}
