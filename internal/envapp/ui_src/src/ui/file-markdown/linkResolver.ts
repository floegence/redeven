export type FileMarkdownResolvedLink =
  | Readonly<{ kind: 'external'; href: string }>
  | Readonly<{ kind: 'heading'; href: string; targetId: string }>
  | Readonly<{ kind: 'file'; href: string; path: string; fragment: string }>
  | Readonly<{ kind: 'unresolved-local'; href: string; reason: string }>;

const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitHref(href: string): { path: string; fragment: string } {
  const raw = compact(href);
  const hashIndex = raw.indexOf('#');
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutFragment.indexOf('?');
  return {
    path: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    fragment: hashIndex >= 0 ? raw.slice(hashIndex + 1) : '',
  };
}

function normalizeAbsolutePath(path: string): string {
  const raw = compact(path).replace(/\\+/g, '/');
  if (!raw.startsWith('/')) return '';

  const output: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      output.pop();
      continue;
    }
    output.push(segment);
  }

  return `/${output.join('/')}`.replace(/\/+$/, '') || '/';
}

function dirname(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized || normalized === '/') return normalized || '';
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex);
}

function isExternalHref(href: string): boolean {
  if (href.startsWith('//')) return true;
  if (WINDOWS_ABSOLUTE_PATH_RE.test(href)) return false;
  return EXPLICIT_SCHEME_RE.test(href);
}

export function resolveFileMarkdownLocalPath(href: string, currentFilePath?: string | null): string {
  const rawHref = compact(href);
  if (!rawHref) return '';

  const { path } = splitHref(rawHref);
  const decodedPath = decodeUriComponentSafe(path.replace(/\\/g, '/'));
  if (!decodedPath) return '';

  if (decodedPath.startsWith('/')) {
    return normalizeAbsolutePath(decodedPath);
  }

  if (WINDOWS_ABSOLUTE_PATH_RE.test(decodedPath)) {
    return decodedPath.replace(/\\+/g, '/');
  }

  const baseDir = dirname(currentFilePath ?? '');
  if (!baseDir) return '';
  return normalizeAbsolutePath(`${baseDir}/${decodedPath}`);
}

export function resolveFileMarkdownLink(href: string, currentFilePath?: string | null): FileMarkdownResolvedLink {
  const rawHref = compact(href);
  if (!rawHref) {
    return { kind: 'unresolved-local', href: rawHref, reason: 'empty_href' };
  }

  if (rawHref.startsWith('#')) {
    return {
      kind: 'heading',
      href: rawHref,
      targetId: decodeUriComponentSafe(rawHref.slice(1)),
    };
  }

  if (isExternalHref(rawHref)) {
    return { kind: 'external', href: rawHref };
  }

  const { fragment } = splitHref(rawHref);
  const path = resolveFileMarkdownLocalPath(rawHref, currentFilePath);
  if (!path) {
    return { kind: 'unresolved-local', href: rawHref, reason: 'missing_current_file_path' };
  }

  return {
    kind: 'file',
    href: rawHref,
    path,
    fragment: decodeUriComponentSafe(fragment),
  };
}
