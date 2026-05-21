import { isWithinAbsolutePath, normalizeAbsolutePath } from './askFlowerPath';
import type { NormalizedFilesystemRoot } from './filesystemRoots';
import { formatFilesystemPath, parseFilesystemPathInput } from './filesystemRoots';

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

function resolveBrowserRootRelativePath(rawValue: string, rootPathAbs: string): string {
  const raw = compactPathInput(rawValue);
  if (!raw.startsWith('/')) return raw;
  if (raw === '/') return raw;
  if (isWithinAbsolutePath(raw, rootPathAbs)) return raw;
  return normalizeAbsolutePath(`${rootPathAbs}/${raw.slice(1)}`);
}

export function formatFileBrowserPathInputValue(pathAbs: string, rootPathAbs?: string | null): string {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return '';

  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  return formatFilesystemPath(normalizedPath, normalizedRoot) || normalizedPath;
}

export function parseFileBrowserPathInput(rawValue: string, rootPathAbs?: string | null): ParsedFileBrowserPathInput {
  const raw = compactPathInput(rawValue);
  if (!raw) {
    return { kind: 'error', message: 'Path is required.' };
  }

  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');

  if (!raw.startsWith('/') && raw !== '~' && !raw.startsWith('~/') && !raw.startsWith('~\\')) {
    return {
      kind: 'error',
      message: normalizedRoot ? 'Use "/" or "~" to enter a path.' : 'Enter an absolute path.',
    };
  }

  const absolutePath = parseFilesystemPathInput(
    normalizedRoot ? resolveBrowserRootRelativePath(raw, normalizedRoot) : raw,
    normalizedRoot,
  );
  if (!absolutePath) {
    return { kind: 'error', message: raw.startsWith('~') ? 'Home directory is unavailable.' : 'Enter an absolute path.' };
  }

  return {
    kind: 'ok',
    absolutePath,
    displayPath: formatFileBrowserPathInputValue(absolutePath, normalizedRoot),
  };
}

export function pathInputIncludesHiddenSegment(
  pathAbs: string,
  rootPathAbs?: string | null,
  roots?: readonly NormalizedFilesystemRoot[],
): boolean {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return false;

  const matchedRoot = roots
    ?.filter((root) => isWithinAbsolutePath(normalizedPath, root.pathAbs))
    .sort((a, b) => b.pathAbs.length - a.pathAbs.length)[0];
  const normalizedRoot = normalizeAbsolutePath(matchedRoot?.pathAbs ?? rootPathAbs ?? '');
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
