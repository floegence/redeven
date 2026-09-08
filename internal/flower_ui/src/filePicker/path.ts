export function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '';

  if (!raw.startsWith('/')) return '';
  const collapsed = raw.replace(/\/+/g, '/');

  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.replace(/\/+$/g, '') || '/' : collapsed;
}

export function basenameFromAbsolutePath(path: string, fallback = ''): string {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized) return fallback;
  if (normalized === '/') return '/';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || fallback;
}
