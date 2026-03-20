// Floating file browser FAB for the chat page.
// The FAB lives inside the message area and can be dragged to any edge.
import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { Motion } from 'solid-motionone';
import { useNotification } from '@floegence/floe-webapp-core';
import { Folder } from '@floegence/floe-webapp-core/icons';
import { FileBrowser, type ContextMenuCallbacks, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { ConfirmDialog, DirectoryPicker, FileSavePicker } from '@floegence/floe-webapp-core/ui';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from '../pages/EnvContext';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { getLocalRuntime } from '../services/controlplaneApi';
import { buildDetachedFileBrowserSurface, isDesktopManagedRuntime, openDetachedSurfaceWindow } from '../services/detachedSurface';
import {
  mapContextMenuCallbacksToAbsolute,
  mapFileItemToAbsolutePath,
  mapFileItemsToDisplayPath,
  toFileBrowserAbsolutePath,
  toFileBrowserDisplayPath,
} from '../utils/fileBrowserDisplayPath';
import { copyFileBrowserItemNames, describeCopiedFileBrowserItemNames } from '../utils/fileBrowserClipboard';
import { useFilePreviewContext } from './FilePreviewContext';
import { InputDialog } from './InputDialog';
import { PersistentFloatingWindow } from './PersistentFloatingWindow';
import {
  extNoDot,
  fileNameFromPath,
  getParentDir,
  insertItemToTree,
  normalizePath,
  removeItemsFromTree,
  rewriteCachePathPrefix,
  rewriteSubtreePaths,
  sortFileItems,
  toFileItem,
  withChildrenAtRoot,
} from './FileBrowserShared';

export interface ChatFileBrowserFABProps {
  workingDir: string;
  homePath?: string;
  enabled?: boolean;
  /** Ref to the container element that bounds the FAB drag area. */
  containerRef?: HTMLElement;
}

// ---- helpers ----

function normalizeAbsolutePath(path: string): string {
  const raw = String(path ?? '').trim();
  if (!raw || !raw.startsWith('/')) return '';
  return normalizePath(raw);
}

const FAB_SIZE = 44;
const EDGE_MARGIN = 12;
const FILE_BROWSER_WINDOW_Z_INDEX = 44;
const CHAT_FAB_SIDEBAR_WIDTH_STORAGE_KEY = 'chat-fab-files:sidebar-width';

// ---- component ----

export function ChatFileBrowserFAB(props: ChatFileBrowserFABProps) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const notification = useNotification();
  const filePreview = useFilePreviewContext();

  // -- browser state --
  const [browserOpen, setBrowserOpen] = createSignal(false);
  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [resetSeq, setResetSeq] = createSignal(0);
  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('');

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
  let lastLoadedPath = '';

  const initialPath = createMemo(() => normalizePath(props.workingDir));
  const browserRootPath = createMemo(() => normalizeAbsolutePath(props.homePath ?? props.workingDir) || initialPath());
  const browserHomeLabel = createMemo(() => (normalizeAbsolutePath(props.homePath ?? '') ? 'Home' : 'Working Dir'));
  const displayFiles = createMemo(() => mapFileItemsToDisplayPath(files(), browserRootPath()));
  const displayInitialPath = createMemo(() => toFileBrowserDisplayPath(initialPath(), browserRootPath()));

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
    const scopedRootPath = normalizePath(browserRootPath() || p);

    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildrenAtRoot(prev, p, cache.get(p)!, scopedRootPath));
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
      if (seq === dirReqSeq) setFiles((prev) => withChildrenAtRoot(prev, p, items, scopedRootPath));
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async function loadPathChain(path: string) {
    if (!protocol.client()) return;
    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    const root = normalizeAbsolutePath(props.homePath ?? props.workingDir) || p;
    const rel = p === root ? '' : p.startsWith(`${root}/`) ? p.slice(root.length) : '';
    const parts = rel.split('/').filter(Boolean);
    const chain: string[] = [root];
    let reachedTarget = p === root;
    let cursor = root;
    for (const part of parts) {
      cursor = cursor === '/' ? `/${part}` : `${cursor}/${part}`;
      chain.push(cursor);
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
      if (seq === dirReqSeq) lastLoadedPath = reachedTarget ? p : root;
    } finally {
      if (seq === dirReqSeq) setLoading(false);
    }
  }

  const applyLocalRelocate = (item: FileItem, finalDestPath: string) => {
    const from = normalizePath(item.path);
    const to = normalizePath(finalDestPath);
    const scopedRootPath = normalizePath(browserRootPath() || getParentDir(from));
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
      return insertItemToTree(removed, destDir, movedItem, scopedRootPath);
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
      rewriteCachePathPrefix(cache, from, to);
    }
  };

  const applyLocalCopy = (item: FileItem, finalDestPath: string) => {
    const from = normalizePath(item.path);
    const to = normalizePath(finalDestPath);
    const destDir = getParentDir(to);
    const scopedRootPath = normalizePath(browserRootPath() || destDir);
    const nextName = fileNameFromPath(to) || item.name;
    const copiedItem = {
      ...rewriteSubtreePaths(item, from, to),
      id: to,
      path: to,
      name: nextName,
      extension: item.type === 'file' ? extNoDot(nextName) : undefined,
    } satisfies FileItem;

    setFiles((prev) => insertItemToTree(prev, destDir, copiedItem, scopedRootPath));

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

  const handleCopyName = (items: FileItem[]) => {
    void (async () => {
      try {
        const result = await copyFileBrowserItemNames(items);
        notification.success('Copied', describeCopiedFileBrowserItemNames(result));
      } catch (e) {
        notification.error('Copy failed', e instanceof Error ? e.message : String(e));
      }
    })();
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
    onCopyName: (items) => {
      handleCopyName(items);
    },
  };
  const displayContextMenuCallbacks = createMemo(() => mapContextMenuCallbacksToAbsolute(ctxMenu, browserRootPath()));

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
      void (async () => {
        const wd = untrack(initialPath);
        if (!wd) return;

        try {
          const runtime = env.localRuntime() ?? await getLocalRuntime();
          if (isDesktopManagedRuntime(runtime)) {
            const surface = buildDetachedFileBrowserSurface({
              path: wd,
              homePath: untrack(browserRootPath),
            });
            if (surface) {
              openDetachedSurfaceWindow(surface);
              return;
            }
          }
        } catch {
          // Fall back to the in-app floating window when local runtime inspection fails.
        }

        if (!cache.has(wd) || lastLoadedPath !== wd) {
          await loadPathChain(wd);
        }
        setBrowserOpen(true);
      })();
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
      <PersistentFloatingWindow
        open={browserOpen()}
        onOpenChange={(open) => {
          setBrowserOpen(open);
        }}
        title="File Browser"
        persistenceKey="chat-file-browser"
        defaultSize={{ width: 560, height: 520 }}
        minSize={{ width: 380, height: 340 }}
        zIndex={FILE_BROWSER_WINDOW_Z_INDEX}
      >
        <div class="h-full relative">
          <Show when={resetSeq() + 1} keyed>
            {(_seq) => (
              <FileBrowser
                files={displayFiles()}
                initialPath={displayInitialPath()}
                initialViewMode="grid"
                homeLabel={browserHomeLabel()}
                sidebarWidth={200}
                sidebarWidthStorageKey={CHAT_FAB_SIDEBAR_WIDTH_STORAGE_KEY}
                persistenceKey="chat-fab-files"
                instanceId="chat-fab-files"
                onNavigate={(path) => {
                  const target = toFileBrowserAbsolutePath(path, browserRootPath()) || browserRootPath();
                  setCurrentBrowserPath(target);
                  void (async () => {
                    await loadPathChain(target);
                  })();
                }}
                onOpen={(item) => void filePreview.openPreview(mapFileItemToAbsolutePath(item, browserRootPath()))}
                contextMenuCallbacks={displayContextMenuCallbacks()}
                class="h-full border-0 rounded-none shadow-none"
              />
            )}
          </Show>
          <LoadingOverlay visible={loading()} message="Loading files..." />
        </div>
      </PersistentFloatingWindow>

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
