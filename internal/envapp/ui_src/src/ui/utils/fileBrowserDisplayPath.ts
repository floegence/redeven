import type {
  ContextMenuCallbacks,
  ContextMenuDirectory,
  ContextMenuEvent,
  ContextMenuItem,
  FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { isWithinAbsolutePath, normalizeAbsolutePath } from './askFlowerPath';

function normalizeDisplayPath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';

  const withSlashes = raw.replace(/\\+/g, '/');
  const prefixed = withSlashes.startsWith('/') ? withSlashes : `/${withSlashes}`;
  const collapsed = prefixed.replace(/\/+/g, '/');

  if (collapsed === '/') return '/';
  return collapsed.endsWith('/') ? collapsed.replace(/\/+$/, '') || '/' : collapsed;
}

export function toFileBrowserDisplayPath(pathAbs: string, rootPathAbs?: string | null): string {
  const normalizedPath = normalizeAbsolutePath(pathAbs);
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');

  if (!normalizedRoot) {
    return normalizeDisplayPath(normalizedPath || pathAbs);
  }
  if (!normalizedPath || !isWithinAbsolutePath(normalizedPath, normalizedRoot)) {
    return '/';
  }
  if (normalizedPath === normalizedRoot) {
    return '/';
  }
  return normalizeDisplayPath(normalizedPath.slice(normalizedRoot.length));
}

export function toFileBrowserAbsolutePath(displayPath: string, rootPathAbs?: string | null): string {
  const normalizedRoot = normalizeAbsolutePath(rootPathAbs ?? '');
  const normalizedDisplay = normalizeDisplayPath(displayPath);

  if (!normalizedRoot) {
    return normalizeAbsolutePath(normalizedDisplay);
  }
  if (normalizedDisplay === '/') {
    return normalizedRoot;
  }
  return normalizeAbsolutePath(`${normalizedRoot}${normalizedDisplay}`);
}

export function mapFileItemToDisplayPath(item: FileItem, rootPathAbs?: string | null): FileItem {
  const nextPath = toFileBrowserDisplayPath(item.path, rootPathAbs);
  return {
    ...item,
    id: nextPath,
    path: nextPath,
    children: item.children?.map((child) => mapFileItemToDisplayPath(child, rootPathAbs)),
  };
}

export function mapFileItemsToDisplayPath(items: FileItem[], rootPathAbs?: string | null): FileItem[] {
  return items.map((item) => mapFileItemToDisplayPath(item, rootPathAbs));
}

export function mapFileItemToAbsolutePath(item: FileItem, rootPathAbs?: string | null): FileItem {
  const nextPath = toFileBrowserAbsolutePath(item.path, rootPathAbs);
  return {
    ...item,
    id: nextPath,
    path: nextPath,
    children: item.children?.map((child) => mapFileItemToAbsolutePath(child, rootPathAbs)),
  };
}

export function mapFileItemsToAbsolutePath(items: FileItem[], rootPathAbs?: string | null): FileItem[] {
  return items.map((item) => mapFileItemToAbsolutePath(item, rootPathAbs));
}

function mapContextMenuDirectoryToAbsolutePath(
  directory: ContextMenuDirectory | null | undefined,
  rootPathAbs?: string | null,
): ContextMenuDirectory | null {
  if (!directory) return null;
  return {
    path: toFileBrowserAbsolutePath(directory.path, rootPathAbs),
    item: directory.item ? mapFileItemToAbsolutePath(directory.item, rootPathAbs) : undefined,
  };
}

export function mapContextMenuEventToAbsolutePath(
  event: ContextMenuEvent | null | undefined,
  rootPathAbs?: string | null,
): ContextMenuEvent | null {
  if (!event) return null;
  return {
    ...event,
    items: mapFileItemsToAbsolutePath(event.items, rootPathAbs),
    directory: mapContextMenuDirectoryToAbsolutePath(event.directory, rootPathAbs),
  };
}

export function mapContextMenuCallbacksToAbsolute(
  callbacks: ContextMenuCallbacks | undefined,
  rootPathAbs?: string | null,
): ContextMenuCallbacks | undefined {
  if (!callbacks) return undefined;

  return {
    onDelete: callbacks.onDelete
      ? (items) => callbacks.onDelete?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
    onDuplicate: callbacks.onDuplicate
      ? (items) => callbacks.onDuplicate?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
    onCopyName: callbacks.onCopyName
      ? (items) => callbacks.onCopyName?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
    onCopyTo: callbacks.onCopyTo
      ? (items) => callbacks.onCopyTo?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
    onMoveTo: callbacks.onMoveTo
      ? (items) => callbacks.onMoveTo?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
    onRename: callbacks.onRename
      ? (item) => callbacks.onRename?.(mapFileItemToAbsolutePath(item, rootPathAbs))
      : undefined,
    onAskAgent: callbacks.onAskAgent
      ? (items) => callbacks.onAskAgent?.(mapFileItemsToAbsolutePath(items, rootPathAbs))
      : undefined,
  };
}

export function mapContextMenuItemsToAbsolute(
  items: ContextMenuItem[] | undefined,
  rootPathAbs?: string | null,
): ContextMenuItem[] {
  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    ...item,
    children: item.children ? mapContextMenuItemsToAbsolute(item.children, rootPathAbs) : undefined,
    onAction: item.onAction
      ? (selectedItems: FileItem[], event?: ContextMenuEvent) => item.onAction?.(
          mapFileItemsToAbsolutePath(selectedItems, rootPathAbs),
          mapContextMenuEventToAbsolutePath(event, rootPathAbs) ?? undefined,
        )
      : undefined,
  }));
}
