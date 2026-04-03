import { expandHomeDisplayPath, isWithinAbsolutePath, normalizeAbsolutePath, toHomeDisplayPath } from './askFlowerPath';
import { toFileBrowserAbsolutePath } from './fileBrowserDisplayPath';

export type ParsedFileBrowserPathInput =
  | {
      kind: 'ok';
      absolutePath: string;
      displayPath: string;
    }
  | {
      kind: 'error';
      message: string;
    };

function compactPathInput(value: string): string {
  return String(value ?? '').trim();
}

export function formatFileBrowserPathInputValue(pathAbs: string, rootPathAbs?: string | null): string {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return '';

  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  if (!normalizedRoot) {
    return normalizedPath;
  }

  return toHomeDisplayPath(normalizedPath, normalizedRoot) || normalizedPath;
}

export function parseFileBrowserPathInput(rawValue: string, rootPathAbs?: string | null): ParsedFileBrowserPathInput {
  const raw = compactPathInput(rawValue);
  if (!raw) {
    return { kind: 'error', message: 'Path is required.' };
  }

  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');

  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) {
    if (!normalizedRoot) {
      return { kind: 'error', message: 'Home directory is unavailable.' };
    }

    const expanded = expandHomeDisplayPath(raw, normalizedRoot);
    if (!expanded) {
      return { kind: 'error', message: 'Enter a valid path.' };
    }

    return {
      kind: 'ok',
      absolutePath: expanded,
      displayPath: formatFileBrowserPathInputValue(expanded, normalizedRoot),
    };
  }

  if (!normalizedRoot) {
    const absolutePath = normalizeAbsolutePath(raw);
    if (!absolutePath) {
      return { kind: 'error', message: 'Enter an absolute path.' };
    }

    return {
      kind: 'ok',
      absolutePath,
      displayPath: formatFileBrowserPathInputValue(absolutePath),
    };
  }

  if (!raw.startsWith('/')) {
    return { kind: 'error', message: 'Use "/" or "~" to enter a path.' };
  }

  const absoluteCandidate = normalizeAbsolutePath(raw);
  if (absoluteCandidate && isWithinAbsolutePath(absoluteCandidate, normalizedRoot)) {
    return {
      kind: 'ok',
      absolutePath: absoluteCandidate,
      displayPath: formatFileBrowserPathInputValue(absoluteCandidate, normalizedRoot),
    };
  }

  const absolutePath = toFileBrowserAbsolutePath(raw, normalizedRoot);
  if (!absolutePath || !isWithinAbsolutePath(absolutePath, normalizedRoot)) {
    return { kind: 'error', message: 'Path is outside the runtime home directory.' };
  }

  return {
    kind: 'ok',
    absolutePath,
    displayPath: formatFileBrowserPathInputValue(absolutePath, normalizedRoot),
  };
}

export function pathInputIncludesHiddenSegment(pathAbs: string, rootPathAbs?: string | null): boolean {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return false;

  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  if (normalizedRoot && !isWithinAbsolutePath(normalizedPath, normalizedRoot)) {
    return false;
  }

  const relativePath = normalizedRoot && normalizedPath !== normalizedRoot
    ? normalizedPath.slice(normalizedRoot.length)
    : normalizedRoot
      ? ''
      : normalizedPath;

  return relativePath
    .split('/')
    .filter(Boolean)
    .some((segment) => segment.startsWith('.'));
}
