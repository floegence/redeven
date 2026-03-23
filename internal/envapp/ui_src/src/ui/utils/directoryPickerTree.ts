import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { normalizeAbsolutePath } from './askFlowerPath';
import { toFileBrowserAbsolutePath, toFileBrowserDisplayPath } from './fileBrowserDisplayPath';

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

export function toPickerTreePath(pathAbs: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  return toFileBrowserDisplayPath(normalizedPath || pathAbs, normalizedRoot);
}

export function toPickerTreeAbsolutePath(path: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  return toFileBrowserAbsolutePath(normalizePickerTreePath(path), normalizedRoot);
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
