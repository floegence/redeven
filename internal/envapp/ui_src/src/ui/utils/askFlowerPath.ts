export function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '';

  const withSlashes = raw.replace(/\\+/g, '/');
  if (!withSlashes.startsWith('/')) return '';
  const collapsed = withSlashes.replace(/\/+/g, '/');

  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.replace(/\/+$/, '') || '/' : collapsed;
}

function dirname(path: string): string {
  const normalized = String(path ?? '').trim() || '/';
  if (normalized === '/') return '/';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx) || '/';
}

function splitPath(path: string): string[] {
  const normalized = String(path ?? '').trim() || '/';
  if (normalized === '/') return [];
  return normalized.slice(1).split('/').filter(Boolean);
}

function commonAncestor(paths: string[], fallback: string): string {
  const normalized = paths.map((it) => normalizeAbsolutePath(it)).filter((it) => it);

  if (normalized.length <= 0) return fallback;
  if (normalized.length === 1) return normalized[0] ?? fallback;

  const firstParts = splitPath(normalized[0] ?? fallback);
  let keep = firstParts.length;

  for (let i = 1; i < normalized.length; i += 1) {
    const parts = splitPath(normalized[i] ?? fallback);
    keep = Math.min(keep, parts.length);
    for (let j = 0; j < keep; j += 1) {
      if (firstParts[j] !== parts[j]) {
        keep = j;
        break;
      }
    }
    if (keep === 0) return fallback;
  }

  if (keep <= 0) return fallback;
  return `/${firstParts.slice(0, keep).join('/')}`;
}

export function dirnameAbsolute(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized) return '';
  return dirname(normalized);
}

export function commonAncestorAbsolute(paths: string[]): string {
  return commonAncestor(paths, '/');
}

export function deriveAbsoluteWorkingDirFromItems(
  items: Array<{ path: string; isDirectory: boolean }>,
  fallback = '/',
): string {
  if (items.length <= 0) {
    return normalizeAbsolutePath(fallback);
  }

  const dirs = items
    .map((item) => {
      const normalizedPath = normalizeAbsolutePath(item.path);
      if (!normalizedPath) return '';
      if (item.isDirectory) return normalizedPath;
      return dirnameAbsolute(normalizedPath);
    })
    .filter((it) => it);

  if (dirs.length <= 0) {
    return normalizeAbsolutePath(fallback);
  }

  if (dirs.length === 1) {
    return normalizeAbsolutePath(dirs[0] ?? fallback);
  }

  return commonAncestorAbsolute(dirs);
}

export function isWithinAbsolutePath(path: string, parentPath: string): boolean {
  const normalizedPath = normalizeAbsolutePath(path);
  const normalizedParent = normalizeAbsolutePath(parentPath);
  if (!normalizedPath || !normalizedParent) return false;
  if (normalizedPath === normalizedParent) return true;
  if (normalizedParent === '/') return normalizedPath.startsWith('/');
  return normalizedPath.startsWith(`${normalizedParent}/`);
}

export function toHomeDisplayPath(path: string, agentHomePath?: string | null): string {
  const normalizedPath = normalizeAbsolutePath(path);
  if (!normalizedPath) return '';

  const normalizedHome = normalizeAbsolutePath(agentHomePath ?? '');
  if (!normalizedHome || normalizedHome === '/' || !isWithinAbsolutePath(normalizedPath, normalizedHome)) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedHome) return '~';
  return `~${normalizedPath.slice(normalizedHome.length)}`;
}

export function expandHomeDisplayPath(path: string, agentHomePath?: string | null): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '';

  const normalizedHome = normalizeAbsolutePath(agentHomePath ?? '');
  if (raw === '~') return normalizedHome;
  if ((raw.startsWith('~/') || raw.startsWith('~\\')) && normalizedHome) {
    const suffix = raw.slice(2).replace(/\\+/g, '/');
    return normalizeAbsolutePath(`${normalizedHome}/${suffix}`);
  }
  return normalizeAbsolutePath(raw);
}

export function resolveSuggestedWorkingDirAbsolute(params: {
  suggestedWorkingDirAbs?: string | null;
}): string {
  return normalizeAbsolutePath(params.suggestedWorkingDirAbs ?? '');
}
