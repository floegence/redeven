export function normalizeVirtualPath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';

  const withSlashes = raw.replace(/\\+/g, '/');
  const prefixed = withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
  const collapsed = prefixed.replace(/\/+/g, '/');

  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.replace(/\/+$/, '') || '/' : collapsed;
}

export function dirnameVirtual(path: string): string {
  const normalized = normalizeVirtualPath(path);
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx) || '/';
}

function splitVirtualPath(path: string): string[] {
  const normalized = normalizeVirtualPath(path);
  if (normalized === '/') return [];
  return normalized.slice(1).split('/').filter(Boolean);
}

export function commonAncestor(paths: string[]): string {
  const normalized = paths
    .map((it) => normalizeVirtualPath(it))
    .filter((it) => it);

  if (normalized.length <= 0) return '/';
  if (normalized.length === 1) return normalized[0] ?? '/';

  const firstParts = splitVirtualPath(normalized[0] ?? '/');
  let keep = firstParts.length;

  for (let i = 1; i < normalized.length; i += 1) {
    const parts = splitVirtualPath(normalized[i] ?? '/');
    keep = Math.min(keep, parts.length);
    for (let j = 0; j < keep; j += 1) {
      if (firstParts[j] !== parts[j]) {
        keep = j;
        break;
      }
    }
    if (keep === 0) return '/';
  }

  if (keep <= 0) return '/';
  return `/${firstParts.slice(0, keep).join('/')}`;
}

export function deriveWorkingDirFromItems(
  items: Array<{ path: string; isDirectory: boolean }>,
  fallback = '/',
): string {
  if (items.length <= 0) {
    return normalizeVirtualPath(fallback);
  }

  const dirs = items
    .map((item) => {
      const normalizedPath = normalizeVirtualPath(item.path);
      if (item.isDirectory) return normalizedPath;
      return dirnameVirtual(normalizedPath);
    })
    .filter((it) => it);

  if (dirs.length <= 0) {
    return normalizeVirtualPath(fallback);
  }

  if (dirs.length === 1) {
    return normalizeVirtualPath(dirs[0] ?? fallback);
  }

  return commonAncestor(dirs);
}
