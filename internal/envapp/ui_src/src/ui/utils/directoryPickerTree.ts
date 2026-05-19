import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { normalizeAbsolutePath } from './askFlowerPath';

type DirectoryEntryLike = {
  name?: string | null;
  path?: string | null;
  isDirectory?: boolean | null;
  size?: number | null;
  modifiedAt?: number | null;
};

export function normalizePickerTreePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';

  const withSlashes = raw.replace(/\\+/g, '/');
  const prefixed = withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
  const collapsed = prefixed.replace(/\/+/g, '/');

  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.replace(/\/+$/, '') || '/' : collapsed;
}

export function listPickerTreePathChain(path: string): string[] {
  const normalized = normalizePickerTreePath(path);
  if (normalized === '/') return ['/'];

  const parts = normalized.split('/').filter(Boolean);
  const chain = ['/'];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    chain.push(current);
  }
  return chain;
}

function pathIsAtOrUnderRoot(pathAbs: string, rootPathAbs: string): boolean {
  if (!pathAbs || !rootPathAbs) return false;
  return pathAbs === rootPathAbs || pathAbs.startsWith(`${rootPathAbs}/`);
}

export function toPickerTreePath(pathAbs: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  if (!normalizedPath) return '/';
  if (!normalizedRoot || !pathIsAtOrUnderRoot(normalizedPath, normalizedRoot)) {
    return normalizePickerTreePath(normalizedPath);
  }
  if (normalizedPath === normalizedRoot) return '/';
  return normalizePickerTreePath(normalizedPath.slice(normalizedRoot.length));
}

export function toPickerTreeAbsolutePath(path: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  const raw = String(path ?? '').trim();
  const normalizedRawAbsolute = normalizeAbsolutePath(raw);
  if (normalizedRoot && pathIsAtOrUnderRoot(normalizedRawAbsolute, normalizedRoot)) {
    return normalizedRawAbsolute;
  }

  const treePath = normalizePickerTreePath(path);
  if (!normalizedRoot) {
    return normalizeAbsolutePath(treePath);
  }
  if (treePath === '/') return normalizedRoot;
  return normalizeAbsolutePath(`${normalizedRoot}${treePath}`);
}

export function normalizePickerTreeInput(path: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  const normalizedRawAbsolute = normalizeAbsolutePath(String(path ?? '').trim());
  if (normalizedRoot && pathIsAtOrUnderRoot(normalizedRawAbsolute, normalizedRoot)) {
    return toPickerTreePath(normalizedRawAbsolute, normalizedRoot);
  }
  return normalizePickerTreePath(path);
}

export function toPickerFolderItem(entry: DirectoryEntryLike, rootPathAbs?: string | null): FileItem | null {
  if (!entry?.isDirectory) return null;

  const absolutePath = normalizeAbsolutePath(String(entry.path ?? ''));
  if (!absolutePath) return null;

  const name = String(entry.name ?? '');
  const treePath = toPickerTreePath(absolutePath, rootPathAbs);
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  const size = Number(entry.size ?? Number.NaN);

  return {
    id: treePath,
    name,
    type: 'folder',
    path: treePath,
    size: Number.isFinite(size) ? size : undefined,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
  };
}

export function sortPickerFolderItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
}

export function hasPickerFolderPath(tree: readonly FileItem[], folderPath: string): boolean {
  const target = normalizePickerTreePath(folderPath);
  if (target === '/') return true;

  const visit = (items: readonly FileItem[]): boolean => {
    for (const item of items) {
      if (item.type !== 'folder') continue;
      if (normalizePickerTreePath(item.path) === target) {
        return true;
      }
      if (item.children && item.children.length > 0 && visit(item.children)) {
        return true;
      }
    }
    return false;
  };

  return visit(tree);
}

export function replacePickerChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = normalizePickerTreePath(folderPath);
  if (target === '/') {
    return children;
  }

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((item) => {
      if (item.type !== 'folder') return item;
      if (item.path === target) {
        changed = true;
        return { ...item, children };
      }
      if (!item.children || item.children.length === 0) return item;
      const [nextChildren, hit] = visit(item.children);
      if (!hit) return item;
      changed = true;
      return { ...item, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };

  const [next] = visit(tree);
  return next;
}
