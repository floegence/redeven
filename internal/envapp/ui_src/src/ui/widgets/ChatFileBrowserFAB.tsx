// Floating file browser FAB for the chat page.
// The FAB lives inside the message area and can be dragged to any edge.
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Motion } from 'solid-motionone';
import { useNotification } from '@floegence/floe-webapp-core';
import { Folder } from '@floegence/floe-webapp-core/icons';
import { FileBrowser, type ContextMenuCallbacks, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog, Dialog, DirectoryPicker, FileSavePicker, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { previewModeByName, isLikelyTextContent, getExtDot, mimeFromExtDot } from '../utils/filePreview';

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
  /** Ref to the container element that bounds the FAB drag area. */
  containerRef?: HTMLElement;
}

function InputDialog(props: {
  open: boolean;
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = createSignal(props.value);

  createEffect(() => {
    if (props.open) {
      setInputValue(props.value);
    }
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={props.title}
      footer={(
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={props.onCancel} disabled={props.loading}>
            {props.cancelText ?? 'Cancel'}
          </Button>
          <Button size="sm" variant="default" onClick={() => props.onConfirm(inputValue())} loading={props.loading}>
            {props.confirmText ?? 'Confirm'}
          </Button>
        </div>
      )}
    >
      <div>
        <label class="block text-xs text-muted-foreground mb-1">{props.label}</label>
        <input
          type="text"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={inputValue()}
          placeholder={props.placeholder}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !props.loading) {
              props.onConfirm(inputValue());
            } else if (e.key === 'Escape') {
              props.onCancel();
            }
          }}
          autofocus
        />
      </div>
    </Dialog>
  );
}

// ---- helpers ----

function normalizePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw) return '/';
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  if (p === '/') return '/';
  return p.endsWith('/') ? p.replace(/\/+$/, '') || '/' : p;
}

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

function toVirtualWorkingDirPath(workingDir: string, homePath?: string): string {
  const normalized = normalizePath(workingDir);
  const fsRoot = normalizeAbsolutePath(homePath ?? '');
  if (!fsRoot || fsRoot === '/') return normalized;

  const normalizedWorkingDirAbs = normalizeAbsolutePath(workingDir);
  if (!normalizedWorkingDirAbs) return normalized;
  if (normalizedWorkingDirAbs === fsRoot) return '/';
  if (normalizedWorkingDirAbs.startsWith(`${fsRoot}/`)) {
    return normalizePath(normalizedWorkingDirAbs.slice(fsRoot.length));
  }
  return normalized;
}

function extNoDot(name: string): string | undefined {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return undefined;
  return name.slice(idx + 1).toLowerCase();
}

function toFileItem(entry: FsFileInfo): FileItem {
  const isDir = !!entry.isDirectory;
  const name = String(entry.name ?? '');
  const p = String(entry.path ?? '');
  const modifiedAtMs = Number(entry.modifiedAt ?? 0);
  return {
    id: p,
    name,
    type: isDir ? 'folder' : 'file',
    path: p,
    size: Number.isFinite(entry.size) ? entry.size : undefined,
    modifiedAt: Number.isFinite(modifiedAtMs) && modifiedAtMs > 0 ? new Date(modifiedAtMs) : undefined,
    extension: isDir ? undefined : extNoDot(name),
  };
}

function sortFileItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1,
  );
}

/** Recursively set children of a folder node inside a file tree. */
function withChildren(tree: FileItem[], folderPath: string, children: FileItem[]): FileItem[] {
  const target = folderPath.trim() || '/';
  if (target === '/' || target === '') return children;

  const visit = (items: FileItem[]): [FileItem[], boolean] => {
    let changed = false;
    const next = items.map((it) => {
      if (it.type !== 'folder') return it;
      if (it.path === target) {
        changed = true;
        return { ...it, children };
      }
      if (!it.children || it.children.length === 0) return it;
      const [nextChildren, hit] = visit(it.children);
      if (!hit) return it;
      changed = true;
      return { ...it, children: nextChildren };
    });
    return [changed ? next : items, changed];
  };

  const [result] = visit(tree);
  return result;
}

function rewriteSubtreePaths(item: FileItem, fromBase: string, toBase: string): FileItem {
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

function removeItemsFromTree(tree: FileItem[], pathsToRemove: Set<string>): FileItem[] {
  const visit = (items: FileItem[]): FileItem[] =>
    items
      .filter((item) => !pathsToRemove.has(normalizePath(item.path)))
      .map((item) => {
        if (item.type !== 'folder' || !item.children?.length) return item;
        const nextChildren = visit(item.children);
        if (nextChildren === item.children) return item;
        return { ...item, children: nextChildren };
      });

  return visit(tree);
}

function insertItemToTree(tree: FileItem[], parentPath: string, item: FileItem): FileItem[] {
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

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
const FAB_SIZE = 44;
const EDGE_MARGIN = 12;
const FILE_BROWSER_WINDOW_Z_INDEX = 44;
const FILE_PREVIEW_WINDOW_Z_INDEX = 45;

// ---- component ----

export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const notification = useNotification();

  // -- browser state --
  const [browserOpen, setBrowserOpen] = createSignal(false);
  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [resetSeq, setResetSeq] = createSignal(0);
  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('/');

  // -- preview state --
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewItem, setPreviewItem] = createSignal<FileItem | null>(null);
  const [previewText, setPreviewText] = createSignal<string | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = createSignal<string | null>(null);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewMode, setPreviewMode] = createSignal<'text' | 'image' | 'binary' | 'unsupported'>('unsupported');

  // -- context menu actions --
  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteDialogItems, setDeleteDialogItems] = createSignal<FileItem[]>([]);
  const [deleteLoading, setDeleteLoading] = createSignal(false);

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [renameDialogItem, setRenameDialogItem] = createSignal<FileItem | null>(null);
  const [renameLoading, setRenameLoading] = createSignal(false);

  const [moveToDialogOpen, setMoveToDialogOpen] = createSignal(false);
  const [moveToDialogItem, setMoveToDialogItem] = createSignal<FileItem | null>(null);
  const [moveToLoading, setMoveToLoading] = createSignal(false);

  const [copyToDialogOpen, setCopyToDialogOpen] = createSignal(false);
  const [copyToDialogItem, setCopyToDialogItem] = createSignal<FileItem | null>(null);
  const [copyToLoading, setCopyToLoading] = createSignal(false);

  const [duplicateLoading, setDuplicateLoading] = createSignal(false);

  // -- FAB position (px from container top-left) --
  // null = use default CSS position (bottom-right)
  const [fabLeft, setFabLeft] = createSignal<number | null>(null);
  const [fabTop, setFabTop] = createSignal<number | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isSnapping, setIsSnapping] = createSignal(false);
  let dragStart: { px: number; py: number; fabLeft: number; fabTop: number } | null = null;

  // -- dir loading plumbing --
  let cache = new Map<string, FileItem[]>();
  let dirReqSeq = 0;
  let lastLoadedPath = '/';

  const initialPath = createMemo(() => toVirtualWorkingDirPath(props.workingDir, props.homePath));

  createEffect(() => {
    const wd = initialPath();
    const enabled = props.enabled ?? true;
    if (!enabled || !wd) return;
    cache = new Map();
    setFiles([]);
    setCurrentBrowserPath(wd);
    setResetSeq((n) => n + 1);
    void loadPathChain(wd);
  });

  async function loadDirOnce(path: string, seq: number): Promise<'ok' | 'error'> {
    if (seq !== dirReqSeq) return 'ok';
    const p = normalizePath(path);

    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, cache.get(p)!));
      return 'ok';
    }

    if (!protocol.client()) return 'error';

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      if (seq !== dirReqSeq) return 'ok';
      const entries = resp?.entries ?? [];
      const items = sortFileItems(entries.map(toFileItem));
      if (seq !== dirReqSeq) return 'ok';
      cache.set(p, items);
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, items));
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async function loadPathChain(path: string) {
    if (!protocol.client()) return;
    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    const parts = p.split('/').filter(Boolean);
    const chain: string[] = ['/'];
    let reachedTarget = p === '/';
    for (let i = 0; i < parts.length; i += 1) {
      chain.push(`/${parts.slice(0, i + 1).join('/')}`);
    }
    setLoading(true);
    try {
      for (const dir of chain) {
        const res = await loadDirOnce(dir, seq);
        if (res === 'error') {
          reachedTarget = false;
          break;
        }
        if (dir === p) reachedTarget = true;
      }
      if (seq === dirReqSeq) lastLoadedPath = reachedTarget ? p : '/';
    } finally {
      if (seq === dirReqSeq) setLoading(false);
    }
  }

  const getParentDir = (filePath: string): string => {
    const p = normalizePath(filePath);
    const lastSlash = p.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return p.slice(0, lastSlash) || '/';
  };

  const fileNameFromPath = (path: string): string => {
    const p = normalizePath(path);
    if (p === '/') return '';
    return p.slice(p.lastIndexOf('/') + 1);
  };

  const rewriteCachePathPrefix = (fromPrefix: string, toPrefix: string) => {
    const from = normalizePath(fromPrefix);
    const to = normalizePath(toPrefix);
    if (from === to) return;

    const captured: Array<[string, FileItem[]]> = [];
    for (const [key, value] of cache.entries()) {
      const normalizedKey = normalizePath(key);
      if (normalizedKey === from || normalizedKey.startsWith(`${from}/`)) {
        captured.push([normalizedKey, value]);
      }
    }

    if (captured.length <= 0) return;

    for (const [oldKey] of captured) {
      cache.delete(oldKey);
    }

    for (const [oldKey, items] of captured) {
      const newKey = oldKey === from ? to : `${to}${oldKey.slice(from.length)}`;
      cache.set(newKey, sortFileItems(items.map((item) => rewriteSubtreePaths(item, from, to))));
    }
  };

  const applyLocalRelocate = (item: FileItem, finalDestPath: string) => {
    const from = normalizePath(item.path);
    const to = normalizePath(finalDestPath);
    const nextName = fileNameFromPath(to) || item.name;
    const movedItem = {
      ...rewriteSubtreePaths(item, from, to),
      id: to,
      path: to,
      name: nextName,
      extension: item.type === 'file' ? extNoDot(nextName) : undefined,
    } satisfies FileItem;

    const srcDir = getParentDir(from);
    const destDir = getParentDir(to);

    setFiles((prev) => {
      const removed = removeItemsFromTree(prev, new Set([from]));
      return insertItemToTree(removed, destDir, movedItem);
    });

    const srcCached = cache.get(srcDir);
    if (srcCached) {
      cache.set(srcDir, srcCached.filter((cachedItem) => normalizePath(cachedItem.path) !== from));
    }

    const destCached = cache.get(destDir);
    if (destCached) {
      const merged = destCached.filter((cachedItem) => normalizePath(cachedItem.path) !== to);
      cache.set(destDir, sortFileItems([...merged, movedItem]));
    }

    if (item.type === 'folder') {
      rewriteCachePathPrefix(from, to);
    }
  };

  const applyLocalCopy = (item: FileItem, finalDestPath: string) => {
    const from = normalizePath(item.path);
    const to = normalizePath(finalDestPath);
    const destDir = getParentDir(to);
    const nextName = fileNameFromPath(to) || item.name;
    const copiedItem = {
      ...rewriteSubtreePaths(item, from, to),
      id: to,
      path: to,
      name: nextName,
      extension: item.type === 'file' ? extNoDot(nextName) : undefined,
    } satisfies FileItem;

    setFiles((prev) => insertItemToTree(prev, destDir, copiedItem));

    const destCached = cache.get(destDir);
    if (destCached && !destCached.some((cachedItem) => normalizePath(cachedItem.path) === to)) {
      cache.set(destDir, sortFileItems([...destCached, copiedItem]));
    }
  };

  const handleDelete = async (items: FileItem[]) => {
    const client = protocol.client();
    if (!client) {
      notification.error('Delete failed', 'Connection is not ready.');
      return;
    }
    if (items.length <= 0) return;

    setDeleteLoading(true);
    setDeleteDialogOpen(false);

    try {
      for (const item of items) {
        await rpc.fs.delete({ path: item.path, recursive: item.type === 'folder' });
      }

      const pathsToRemove = new Set(items.map((item) => normalizePath(item.path)));
      const removedRoots = Array.from(pathsToRemove);
      const shouldRemovePath = (path: string) => {
        const normalizedPath = normalizePath(path);
        return removedRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`));
      };

      setFiles((prev) => removeItemsFromTree(prev, pathsToRemove));

      for (const key of Array.from(cache.keys())) {
        if (shouldRemovePath(key)) {
          cache.delete(key);
          continue;
        }
        const cached = cache.get(key);
        if (!cached) continue;
        const nextCached = cached.filter((cachedItem) => !shouldRemovePath(cachedItem.path));
        if (nextCached.length !== cached.length) {
          cache.set(key, nextCached);
        }
      }

      notification.success(
        items.length === 1 ? 'Deleted' : 'Delete completed',
        items.length === 1 ? `"${items[0]!.name}" deleted.` : `${items.length} items deleted.`,
      );
    } catch (e) {
      notification.error('Delete failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRename = async (item: FileItem, newName: string) => {
    const client = protocol.client();
    const trimmedName = newName.trim();
    if (!client) {
      notification.error('Rename failed', 'Connection is not ready.');
      return;
    }
    if (!trimmedName) return;

    if (trimmedName === item.name) {
      setRenameDialogOpen(false);
      return;
    }

    const parentDir = getParentDir(item.path);
    const newPath = parentDir === '/' ? `/${trimmedName}` : `${parentDir}/${trimmedName}`;

    setRenameLoading(true);
    setRenameDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath });
      applyLocalRelocate(item, newPath);
      notification.success('Renamed', `"${item.name}" renamed to "${trimmedName}".`);
    } catch (e) {
      notification.error('Rename failed', e instanceof Error ? e.message : String(e));
    } finally {
      setRenameLoading(false);
    }
  };

  const duplicateOne = async (
    item: FileItem,
  ): Promise<{ ok: true; newName: string } | { ok: false }> => {
    const client = protocol.client();
    if (!client) return { ok: false };

    const parentDir = getParentDir(item.path);
    const baseName = item.name;
    const ext = baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.')) : '';
    const nameWithoutExt = ext ? baseName.slice(0, baseName.lastIndexOf('.')) : baseName;
    const newName = `${nameWithoutExt} (copy)${ext}`;
    const destPath = parentDir === '/' ? `/${newName}` : `${parentDir}/${newName}`;

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath });
      applyLocalCopy(item, destPath);
      return { ok: true, newName };
    } catch (e) {
      notification.error('Duplicate failed', e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  };

  const handleMoveTo = async (item: FileItem, destDirPath: string) => {
    const client = protocol.client();
    if (!client) {
      notification.error('Move failed', 'Connection is not ready.');
      return;
    }
    if (!destDirPath.trim()) return;

    const destDir = normalizePath(destDirPath);
    const finalDestPath = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
    if (finalDestPath === normalizePath(item.path)) {
      setMoveToDialogOpen(false);
      return;
    }

    setMoveToLoading(true);
    setMoveToDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath: finalDestPath });
      applyLocalRelocate(item, finalDestPath);
      notification.success('Moved', `"${item.name}" moved to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Move failed', e instanceof Error ? e.message : String(e));
    } finally {
      setMoveToLoading(false);
    }
  };

  const handleCopyTo = async (item: FileItem, destDirPath: string, destFileName: string) => {
    const client = protocol.client();
    const trimmedDestName = destFileName.trim();
    if (!client) {
      notification.error('Copy failed', 'Connection is not ready.');
      return;
    }
    if (!destDirPath.trim() || !trimmedDestName) return;

    const destDir = normalizePath(destDirPath);
    const finalDestPath = destDir === '/' ? `/${trimmedDestName}` : `${destDir}/${trimmedDestName}`;
    if (finalDestPath === normalizePath(item.path)) {
      setCopyToDialogOpen(false);
      return;
    }

    setCopyToLoading(true);
    setCopyToDialogOpen(false);

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath: finalDestPath });
      applyLocalCopy(item, finalDestPath);
      notification.success('Copied', `"${item.name}" copied to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Copy failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCopyToLoading(false);
    }
  };

  const ctxMenu: ContextMenuCallbacks = {
    onDelete: (items) => {
      setDeleteDialogItems(items);
      setDeleteDialogOpen(true);
    },
    onRename: (item) => {
      setRenameDialogItem(item);
      setRenameDialogOpen(true);
    },
    onDuplicate: (items) => {
      void (async () => {
        if (duplicateLoading()) return;
        if (!protocol.client()) {
          notification.error('Duplicate failed', 'Connection is not ready.');
          return;
        }
        setDuplicateLoading(true);
        try {
          let okCount = 0;
          let lastNewName: string | null = null;
          for (const item of items) {
            const ret = await duplicateOne(item);
            if (ret.ok) {
              okCount += 1;
              lastNewName = ret.newName;
            }
          }

          if (okCount <= 0) return;
          if (okCount === 1) {
            notification.success('Duplicated', lastNewName ? `Created "${lastNewName}".` : 'Duplicate completed.');
            return;
          }
          notification.success('Duplicate completed', `${okCount} items duplicated.`);
        } finally {
          setDuplicateLoading(false);
        }
      })();
    },
    onMoveTo: (items) => {
      if (items.length > 0) {
        setMoveToDialogItem(items[0]);
        setMoveToDialogOpen(true);
      }
    },
    onCopyTo: (items) => {
      if (items.length > 0) {
        setCopyToDialogItem(items[0]);
        setCopyToDialogOpen(true);
      }
    },
  };

  // -- preview --
  let previewReqSeq = 0;

  function cleanupPreview() {
    const url = previewObjectUrl();
    if (url) {
      URL.revokeObjectURL(url);
      setPreviewObjectUrl(null);
    }
    setPreviewText(null);
    setPreviewError(null);
  }

  async function openPreview(item: FileItem) {
    const seq = ++previewReqSeq;
    cleanupPreview();
    setPreviewItem(item);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewOpen(true);

    const mode = previewModeByName(item.name);
    if (mode === 'image') {
      setPreviewMode('image');
    } else if (mode === 'text') {
      setPreviewMode('text');
    } else {
      setPreviewMode('unsupported');
    }

    const client = protocol.client();
    if (!client) {
      setPreviewLoading(false);
      setPreviewError('Connection is not ready');
      return;
    }

    try {
      if (mode === 'image') {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
        if (seq !== previewReqSeq) return;
        const ext = getExtDot(item.name);
        const mime = mimeFromExtDot(ext) || 'application/octet-stream';
        const blob = new Blob([bytes], { type: mime });
        setPreviewObjectUrl(URL.createObjectURL(blob));
      } else if (mode === 'text') {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
        if (seq !== previewReqSeq) return;
        setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
      } else {
        const { bytes } = await readFileBytesOnce({ client, path: item.path, maxBytes: SNIFF_BYTES });
        if (seq !== previewReqSeq) return;
        if (isLikelyTextContent(bytes)) {
          setPreviewMode('text');
          if (bytes.length < SNIFF_BYTES) {
            setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
          } else {
            const { bytes: full } = await readFileBytesOnce({ client, path: item.path, maxBytes: MAX_PREVIEW_BYTES });
            if (seq !== previewReqSeq) return;
            setPreviewText(new TextDecoder('utf-8', { fatal: false }).decode(full));
          }
        } else {
          setPreviewMode('binary');
        }
      }
    } catch (e) {
      if (seq !== previewReqSeq) return;
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === previewReqSeq) setPreviewLoading(false);
    }
  }

  onCleanup(() => cleanupPreview());

  // -- Snap to nearest edge of the container --
  function snapToEdge(left: number, top: number) {
    const ct = props.containerRef;
    if (!ct) {
      // no container, just keep position
      setFabLeft(left);
      setFabTop(top);
      return;
    }
    const cw = ct.clientWidth;
    const ch = ct.clientHeight;

    // clamp inside container
    const clampedLeft = Math.max(EDGE_MARGIN, Math.min(left, cw - FAB_SIZE - EDGE_MARGIN));
    const clampedTop = Math.max(EDGE_MARGIN, Math.min(top, ch - FAB_SIZE - EDGE_MARGIN));

    // distance to each edge
    const dLeft = clampedLeft;
    const dRight = cw - FAB_SIZE - clampedLeft;
    const dTop = clampedTop;
    const dBottom = ch - FAB_SIZE - clampedTop;

    const minDist = Math.min(dLeft, dRight, dTop, dBottom);

    let snapLeft = clampedLeft;
    let snapTop = clampedTop;

    // snap to nearest horizontal edge (left/right preference)
    if (minDist === dLeft) {
      snapLeft = EDGE_MARGIN;
    } else if (minDist === dRight) {
      snapLeft = cw - FAB_SIZE - EDGE_MARGIN;
    } else if (minDist === dTop) {
      snapTop = EDGE_MARGIN;
    } else {
      snapTop = ch - FAB_SIZE - EDGE_MARGIN;
    }

    setIsSnapping(true);
    setFabLeft(snapLeft);
    setFabTop(snapTop);
    // remove snapping transition flag after animation
    requestAnimationFrame(() => {
      setTimeout(() => setIsSnapping(false), 250);
    });
  }

  // -- FAB drag handlers --

  function onFabPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const btn = e.currentTarget as HTMLElement;
    btn.setPointerCapture(e.pointerId);

    // if first interaction, compute initial position from the element's offset
    let currentLeft = fabLeft();
    let currentTop = fabTop();
    if (currentLeft == null || currentTop == null) {
      const ct = props.containerRef;
      if (ct) {
        const cw = ct.clientWidth;
        const ch = ct.clientHeight;
        currentLeft = cw - FAB_SIZE - EDGE_MARGIN;
        currentTop = ch - FAB_SIZE - EDGE_MARGIN;
      } else {
        currentLeft = 0;
        currentTop = 0;
      }
      setFabLeft(currentLeft);
      setFabTop(currentTop);
    }

    dragStart = {
      px: e.clientX,
      py: e.clientY,
      fabLeft: currentLeft,
      fabTop: currentTop,
    };
  }

  function onFabPointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.px;
    const dy = e.clientY - dragStart.py;
    // dead zone to distinguish click from drag
    if (!isDragging() && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    setIsDragging(true);

    let newLeft = dragStart.fabLeft + dx;
    let newTop = dragStart.fabTop + dy;

    // clamp to container during drag
    const ct = props.containerRef;
    if (ct) {
      const cw = ct.clientWidth;
      const ch = ct.clientHeight;
      newLeft = Math.max(0, Math.min(newLeft, cw - FAB_SIZE));
      newTop = Math.max(0, Math.min(newTop, ch - FAB_SIZE));
    }

    setFabLeft(newLeft);
    setFabTop(newTop);
  }

  function onFabPointerUp(_e: PointerEvent) {
    if (!dragStart) return;
    const wasDrag = isDragging();
    dragStart = null;
    setIsDragging(false);

    if (wasDrag) {
      // snap to nearest edge
      snapToEdge(fabLeft()!, fabTop()!);
    } else {
      // it was a click — open file browser
      const wd = untrack(initialPath);
      if (!wd) return;
      if (!cache.has(wd) || lastLoadedPath !== wd) {
        void loadPathChain(wd);
      }
      setBrowserOpen(true);
    }
  }

  const showFab = () => (props.enabled ?? true) && !browserOpen();

  const fabStyle = () => {
    const left = fabLeft();
    const top = fabTop();
    if (left == null || top == null) {
      // default position: bottom-right via CSS
      return {};
    }
    return {
      left: `${left}px`,
      top: `${top}px`,
      // clear CSS defaults when using explicit position
      right: 'auto',
      bottom: 'auto',
      transition: isSnapping() ? 'left 0.25s ease-out, top 0.25s ease-out' : 'none',
    };
  };

  return (
    <>
      {/* FAB draggable button */}
      <Show when={showFab()}>
        <div
          class="redeven-fab-file-browser"
          style={fabStyle()}
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, easing: 'ease-out' }}
          >
            <button
              class="redeven-fab-file-browser-btn"
              title="Browse files"
              onPointerDown={onFabPointerDown}
              onPointerMove={onFabPointerMove}
              onPointerUp={onFabPointerUp}
            >
              <Folder class="w-5 h-5" />
            </button>
          </Motion.div>
        </div>
      </Show>

      {/* File browser floating window */}
      <FloatingWindow
        open={browserOpen()}
        onOpenChange={(open) => {
          setBrowserOpen(open);
        }}
        title="File Browser"
        defaultSize={{ width: 560, height: 520 }}
        minSize={{ width: 380, height: 340 }}
        zIndex={FILE_BROWSER_WINDOW_Z_INDEX}
      >
        <div class="h-full relative">
          <Show when={resetSeq() + 1} keyed>
            {(_seq) => (
              <FileBrowser
                files={files()}
                initialPath={initialPath()}
                initialViewMode="list"
                homeLabel="Home"
                sidebarWidth={200}
                persistenceKey="chat-fab-files"
                instanceId="chat-fab-files"
                onNavigate={(path) => {
                  const target = normalizePath(path);
                  setCurrentBrowserPath(target);
                  void (async () => {
                    await loadPathChain(target);
                  })();
                }}
                onOpen={(item) => void openPreview(item)}
                contextMenuCallbacks={ctxMenu}
                class="h-full border-0 rounded-none shadow-none"
              />
            )}
          </Show>
          <LoadingOverlay visible={loading()} message="Loading files..." />
        </div>
      </FloatingWindow>

      {/* File preview floating window */}
      <FloatingWindow
        open={previewOpen()}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            previewReqSeq += 1;
            cleanupPreview();
            setPreviewItem(null);
          }
        }}
        title={previewItem()?.name ?? 'File Preview'}
        defaultSize={{ width: 720, height: 520 }}
        minSize={{ width: 400, height: 300 }}
        zIndex={FILE_PREVIEW_WINDOW_Z_INDEX}
      >
        <div class="h-full flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-border text-[11px] text-muted-foreground font-mono truncate">
            {previewItem()?.path}
          </div>

          <div class="flex-1 min-h-0 overflow-auto relative bg-background">
            <Show when={previewMode() === 'text' && !previewError()}>
              <pre class="p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-text">
                {previewText()}
              </pre>
            </Show>

            <Show when={previewMode() === 'image' && !previewError()}>
              <div class="p-3 h-full flex items-center justify-center">
                <img
                  src={previewObjectUrl()!}
                  alt={previewItem()?.name ?? 'Preview'}
                  class="max-w-full max-h-full object-contain"
                />
              </div>
            </Show>

            <Show when={(previewMode() === 'binary' || previewMode() === 'unsupported') && !previewError() && !previewLoading()}>
              <div class="p-4 text-sm text-muted-foreground">
                <div class="font-medium text-foreground mb-1">
                  {previewMode() === 'binary' ? 'Binary file' : 'Preview not available'}
                </div>
                <div class="text-xs">Preview is not available for this file type.</div>
              </div>
            </Show>

            <Show when={previewError()}>
              <div class="p-4 text-sm text-error">
                <div class="font-medium mb-1">Failed to load file</div>
                <div class="text-xs text-muted-foreground">{previewError()}</div>
              </div>
            </Show>

            <LoadingOverlay visible={previewLoading()} message="Loading file..." />
          </div>
        </div>
      </FloatingWindow>

      <ConfirmDialog
        open={deleteDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(false);
        }}
        title="Delete"
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading()}
        onConfirm={() => void handleDelete(deleteDialogItems())}
      >
        <div class="text-sm text-foreground">
          <Show
            when={deleteDialogItems().length === 1}
            fallback={(
              <>
                Are you sure you want to delete <span class="font-semibold">{deleteDialogItems().length} items</span>?
              </>
            )}
          >
            Are you sure you want to delete <span class="font-semibold">"{deleteDialogItems()[0]?.name}"</span>?
          </Show>
        </div>
      </ConfirmDialog>

      <InputDialog
        open={renameDialogOpen()}
        title="Rename"
        label="New name"
        value={renameDialogItem()?.name ?? ''}
        loading={renameLoading()}
        onConfirm={(newName) => {
          const item = renameDialogItem();
          if (item) void handleRename(item, newName);
        }}
        onCancel={() => setRenameDialogOpen(false)}
      />

      <DirectoryPicker
        open={moveToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setMoveToDialogOpen(false);
        }}
        files={files()}
        initialPath={currentBrowserPath()}
        homeLabel="Home"
        title="Move To"
        confirmText="Move"
        onSelect={(dirPath) => {
          const item = moveToDialogItem();
          if (item) void handleMoveTo(item, dirPath);
        }}
      />

      <FileSavePicker
        open={copyToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setCopyToDialogOpen(false);
        }}
        files={files()}
        initialPath={currentBrowserPath()}
        homeLabel="Home"
        initialFileName={copyToDialogItem()?.name ?? ''}
        title="Copy To"
        confirmText="Copy"
        onSave={(dirPath, fileName) => {
          const item = copyToDialogItem();
          if (item) void handleCopyTo(item, dirPath, fileName);
        }}
      />

      <Show when={duplicateLoading() || moveToLoading() || copyToLoading()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-none">
          <div class="bg-background border border-border rounded-lg shadow-lg px-4 py-3 text-sm">
            {duplicateLoading() ? 'Duplicating...' : moveToLoading() ? 'Moving...' : 'Copying...'}
          </div>
        </div>
      </Show>
    </>
  );
}
