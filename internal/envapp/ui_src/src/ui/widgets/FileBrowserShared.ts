import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

export type FileSystemEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
};

export function normalizePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
  if (normalizedPath === '/') return '/';
  return normalizedPath.endsWith('/') ? normalizedPath.replace(/\/+$/, '') || '/' : normalizedPath;
}

export function extNoDot(name: string): string | undefined {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return undefined;
  return name.slice(idx + 1).toLowerCase();
}

export function toFileItem(entry: FileSystemEntry): FileItem {
  const isDir = !!entry.isDirectory;
  const name = String(entry.name ?? '');
  const path = String(entry.path ?? '');
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  return {
    id: path,
    name,
    type: isDir ? 'folder' : 'file',
    path,
    size: Number.isFinite(entry.size) ? entry.size : undefined,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
    extension: isDir ? undefined : extNoDot(name),
  };
}

export function sortFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1,
  );
}

export function withChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = folderPath.trim() || '/';
  if (target === '/' || target === '') return children;

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

  const [nextTree] = visit(tree);
  return nextTree;
}

export function rewriteSubtreePaths(item: FileItem, fromBase: string, toBase: string): FileItem {
  const from = normalizePath(fromBase);
  const to = normalizePath(toBase);

  const rewritePath = (path: string): string => {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === from) return to;
    if (normalizedPath.startsWith(`${from}/`)) return `${to}${normalizedPath.slice(from.length)}`;
    return normalizedPath;
  };

  const nextPath = rewritePath(item.path);
  const nextChildren = item.children?.map((child) => rewriteSubtreePaths(child, from, to));
  return {
    ...item,
    id: nextPath,
    path: nextPath,
    children: nextChildren,
  };
}

export function removeItemsFromTree(tree: FileItem[], pathsToRemove: Set<string>): FileItem[] {
  const visit = (items: FileItem[]): FileItem[] => items
    .filter((item) => !pathsToRemove.has(normalizePath(item.path)))
    .map((item) => {
      if (item.type !== 'folder' || !item.children?.length) return item;
      const nextChildren = visit(item.children);
      if (nextChildren === item.children) return item;
      return { ...item, children: nextChildren };
    });
  return visit(tree);
}

export function updateItemInTree(tree: FileItem[], oldPath: string, updates: Partial<FileItem>): FileItem[] {
  const targetPath = normalizePath(oldPath);
  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((item) => {
      if (normalizePath(item.path) === targetPath) {
        changed = true;
        return { ...item, ...updates };
      }
      if (item.type !== 'folder' || !item.children?.length) return item;
      const [nextChildren, hit] = visit(item.children);
      if (!hit) return item;
      changed = true;
      return { ...item, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };
  const [nextTree] = visit(tree);
  return nextTree;
}

export function insertItemToTree(tree: FileItem[], parentPath: string, item: FileItem): FileItem[] {
  const targetParent = normalizePath(parentPath);
  const targetItemPath = normalizePath(item.path);

  if (targetParent === '/') {
    if (tree.some((entry) => normalizePath(entry.path) === targetItemPath)) return tree;
    return sortFileItems([...tree, item]);
  }

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((entry) => {
      if (entry.type !== 'folder') return entry;
      if (normalizePath(entry.path) === targetParent) {
        const children = entry.children ?? [];
        if (children.some((child) => normalizePath(child.path) === targetItemPath)) return entry;
        changed = true;
        return { ...entry, children: sortFileItems([...children, item]) };
      }
      if (!entry.children?.length) return entry;
      const [nextChildren, hit] = visit(entry.children);
      if (!hit) return entry;
      changed = true;
      return { ...entry, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };

  const [nextTree] = visit(tree);
  return nextTree;
}

export function getParentDir(path: string): string {
  const normalizedPath = normalizePath(path);
  const lastSlash = normalizedPath.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalizedPath.slice(0, lastSlash) || '/';
}

export function fileNameFromPath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') return '';
  return normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
}

export function rewriteCachePathPrefix(cache: Map<string, FileItem[]>, fromPrefix: string, toPrefix: string): void {
  const from = normalizePath(fromPrefix);
  const to = normalizePath(toPrefix);
  if (from === to) return;

  const capturedEntries: Array<[string, FileItem[]]> = [];
  for (const [key, value] of cache.entries()) {
    const normalizedKey = normalizePath(key);
    if (normalizedKey === from || normalizedKey.startsWith(`${from}/`)) {
      capturedEntries.push([normalizedKey, value]);
    }
  }

  if (capturedEntries.length <= 0) return;

  for (const [oldKey] of capturedEntries) {
    cache.delete(oldKey);
  }

  for (const [oldKey, items] of capturedEntries) {
    const newKey = oldKey === from ? to : `${to}${oldKey.slice(from.length)}`;
    cache.set(newKey, sortFileItems(items.map((item) => rewriteSubtreePaths(item, from, to))));
  }
}
