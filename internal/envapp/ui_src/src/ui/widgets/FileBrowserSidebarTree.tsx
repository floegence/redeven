import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FileItemIcon, useFileBrowser, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import type { NormalizedFilesystemRoot } from '../utils/filesystemRoots';
import { matchFilesystemRoot } from '../utils/filesystemRoots';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';

const MAX_VISIBLE_DEPTH = 5;
const TREE_ROW_BASE_PADDING = 8;
const TREE_ROW_DEPTH_STEP = 12;
const FILE_TREE_TINY_BADGE_CLASS = 'rounded-full border border-border/40 bg-background/80 px-1 py-0 text-[8px] font-medium leading-4 text-muted-foreground';
const FILE_TREE_TINY_ACCENT_BADGE_CLASS = 'rounded-full border border-primary/20 bg-primary/[0.05] px-1 py-0 text-[8px] font-medium leading-4 text-primary/80';

function getPathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function getAncestorPaths(path: string): string[] {
  const segments = getPathSegments(path);
  return segments.slice(0, -1).map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);
}

function getFolderChildren(item: FileItem | null | undefined): FileItem[] {
  return (item?.children ?? []).filter((child) => child.type === 'folder');
}

function buildFolderIndex(items: FileItem[], index: Map<string, FileItem> = new Map<string, FileItem>()): Map<string, FileItem> {
  for (const item of items) {
    if (item.type !== 'folder') continue;
    index.set(item.path, item);
    if (item.children?.length) buildFolderIndex(item.children, index);
  }
  return index;
}

export interface FileBrowserSidebarTreeProps {
  instanceId: string;
  enableDragDrop?: boolean;
  sidebarOpen?: boolean;
  scrollContainer?: () => HTMLElement | null;
  roots?: NormalizedFilesystemRoot[];
  currentPath?: string;
  onRootSelect?: (path: string) => void;
  onRootWritePermissionChange?: (root: NormalizedFilesystemRoot, write: boolean) => Promise<void> | void;
  class?: string;
}

interface FileBrowserSidebarTreeRowProps {
  item: FileItem;
  depth: number;
  instanceId: string;
  enableDragDrop: boolean;
  registerRow: (path: string, el: HTMLButtonElement | null) => void;
}

function FileBrowserSidebarTreeRow(props: FileBrowserSidebarTreeRowProps) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const childFolders = createMemo(() => getFolderChildren(props.item));
  const hasChildren = createMemo(() => childFolders().length > 0);
  const isExpanded = createMemo(() => browser.isExpanded(props.item.path));
  const isCurrent = createMemo(() => browser.currentPath() === props.item.path);
  const compactDepthOverflow = createMemo(() => Math.max(0, props.depth - MAX_VISIBLE_DEPTH));
  const rowPaddingLeft = createMemo(() => `${TREE_ROW_BASE_PADDING + Math.min(props.depth, MAX_VISIBLE_DEPTH) * TREE_ROW_DEPTH_STEP}px`);
  const canAcceptDrop = createMemo(() => {
    if (!props.enableDragDrop || !drag) return false;
    const state = drag.dragState();
    if (!state.isDragging) return false;
    return drag.canDropOn(state.draggedItems, props.item.path, props.item, props.instanceId);
  });
  const isDropTarget = createMemo(() => {
    if (!drag) return false;
    const state = drag.dragState();
    return Boolean(state.isDragging && state.dropTarget?.targetPath === props.item.path);
  });

  onCleanup(() => {
    props.registerRow(props.item.path, null);
  });

  const handleToggleExpand = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasChildren()) return;
    browser.toggleFolder(props.item.path);
  };

  const handleNavigate = () => {
    browser.navigateTo(props.item);
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    browser.showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [props.item],
      targetKind: 'item',
      source: 'tree',
      directory: {
        path: props.item.path,
        item: props.item,
      },
    });
  };

  const handlePointerEnter = (event: PointerEvent) => {
    if (!props.enableDragDrop || !drag) return;
    const state = drag.dragState();
    if (!state.isDragging) return;
    const currentTarget = event.currentTarget as HTMLElement | null;
    drag.setDropTarget({
      instanceId: props.instanceId,
      targetPath: props.item.path,
      targetItem: props.item,
    }, canAcceptDrop(), currentTarget?.getBoundingClientRect() ?? null);
  };

  const handlePointerLeave = () => {
    if (!drag) return;
    const state = drag.dragState();
    if (state.isDragging && state.dropTarget?.targetPath === props.item.path) {
      drag.setDropTarget(null, false);
    }
  };

  return (
    <div class="flex flex-col">
      <div
        {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
        class={cn(
          'group flex items-center rounded-md py-0.5 text-xs transition-all duration-150 ease-out',
          isCurrent() ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'hover:bg-sidebar-accent/60',
          isDropTarget() && canAcceptDrop() && 'bg-primary/15 outline outline-2 outline-primary/60 shadow-sm shadow-primary/10',
          isDropTarget() && !canAcceptDrop() && 'bg-error/10 outline outline-2 outline-dashed outline-error/50',
        )}
        style={{ 'padding-left': rowPaddingLeft() }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <Show when={hasChildren()} fallback={<span class="h-3.5 w-3.5 shrink-0" />}>
          <button
            type="button"
            class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-transform duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
            aria-label={isExpanded() ? 'Collapse folder' : 'Expand folder'}
            aria-expanded={isExpanded()}
            onClick={handleToggleExpand}
          >
            <ChevronRight class={cn('h-3 w-3 opacity-50 transition-transform duration-150', isExpanded() && 'rotate-90')} />
          </button>
        </Show>

        <button
          ref={(el) => {
            props.registerRow(props.item.path, el);
          }}
          type="button"
          data-file-browser-touch-target="true"
          data-tree-row-path={props.item.path}
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded py-0.5 pl-1 pr-1.5 text-left text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
          aria-current={isCurrent() ? 'page' : undefined}
          title={props.item.path}
          onClick={handleNavigate}
          onContextMenu={handleContextMenu}
        >
          <span class={cn('flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground', isCurrent() && 'text-sidebar-accent-foreground')}>
            <Show when={hasChildren() && isExpanded()} fallback={<FileItemIcon item={props.item} class="h-3.5 w-3.5" />}>
              <FileItemIcon item={props.item} open class="h-3.5 w-3.5" />
            </Show>
          </span>
          <span class="min-w-0 flex-1 truncate">{props.item.name}</span>
          <Show when={compactDepthOverflow() > 0}>
            <span class={compactDepthOverflow() > 0 ? FILE_TREE_TINY_ACCENT_BADGE_CLASS : FILE_TREE_TINY_BADGE_CLASS}>
              +{compactDepthOverflow()}
            </span>
          </Show>
        </button>
      </div>

      <Show when={hasChildren() && isExpanded()}>
        <div class="flex flex-col">
          <For each={childFolders()}>
            {(child) => (
              <FileBrowserSidebarTreeRow
                item={child}
                depth={props.depth + 1}
                instanceId={props.instanceId}
                enableDragDrop={props.enableDragDrop}
                registerRow={props.registerRow}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function FileBrowserSidebarTree(props: FileBrowserSidebarTreeProps) {
  const browser = useFileBrowser();
  const rootFolders = createMemo(() => browser.files().filter((item) => item.type === 'folder'));
  const folderIndex = createMemo(() => buildFolderIndex(browser.files()));
  const activeRoot = createMemo(() => matchFilesystemRoot(props.currentPath || browser.currentPath(), props.roots ?? []));
  const [confirmTarget, setConfirmTarget] = createSignal<NormalizedFilesystemRoot | null>(null);
  const [permissionSavingRootID, setPermissionSavingRootID] = createSignal('');
  const rowRefs = new Map<string, HTMLButtonElement>();
  let scrollNonce = 0;

  const registerRow = (path: string, el: HTMLButtonElement | null) => {
    if (el) {
      rowRefs.set(path, el);
      return;
    }
    rowRefs.delete(path);
  };

  createEffect(() => {
    const currentPath = browser.currentPath();
    const index = folderIndex();
    if (currentPath === '/' || index.size === 0) return;

    for (const ancestorPath of getAncestorPaths(currentPath)) {
      if (!index.has(ancestorPath)) continue;
      if (!browser.isExpanded(ancestorPath)) {
        browser.toggleFolder(ancestorPath);
      }
    }
  });

  createEffect(() => {
    const currentPath = browser.currentPath();
    const sidebarOpen = props.sidebarOpen ?? true;
    props.scrollContainer?.();
    scrollNonce += 1;
    const nonce = scrollNonce;

    queueMicrotask(() => {
      if (nonce !== scrollNonce || !sidebarOpen) return;
      const container = props.scrollContainer?.();
      if (!container) return;
      if (currentPath === '/') {
        container.scrollTop = 0;
        return;
      }
      rowRefs.get(currentPath)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });

  const canToggleRootWrite = (root: NormalizedFilesystemRoot) => root.kind === 'computer' || root.kind === 'custom';

  const rootWriteToggleTitle = (root: NormalizedFilesystemRoot) => {
    if (!canToggleRootWrite(root)) return 'Home write access is managed by Runtime Settings.';
    return root.permissions.write ? `Switch ${root.label} to read-only` : `Allow writes for ${root.label}`;
  };

  const applyRootWritePermission = async (root: NormalizedFilesystemRoot, write: boolean) => {
    if (!props.onRootWritePermissionChange || !canToggleRootWrite(root)) return;
    const rootID = String(root.id ?? '').trim();
    setPermissionSavingRootID(rootID);
    try {
      await props.onRootWritePermissionChange(root, write);
    } finally {
      setPermissionSavingRootID((current) => (current === rootID ? '' : current));
    }
  };

  const requestRootWriteToggle = (event: MouseEvent, root: NormalizedFilesystemRoot, write: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canToggleRootWrite(root) || permissionSavingRootID()) return;
    if (root.permissions.write === write) return;
    if (!write) {
      void applyRootWritePermission(root, false);
      return;
    }
    setConfirmTarget(root);
  };

  const confirmRootWriteAccess = async () => {
    const root = confirmTarget();
    if (!root) return;
    try {
      await applyRootWritePermission(root, true);
      setConfirmTarget(null);
    } catch {
      // The caller owns user-facing failure notification; keep the dialog open.
    }
  };

  return (
    <>
      <div class={cn('flex min-h-full flex-col', props.class)}>
        <Show when={(props.roots?.length ?? 0) > 0}>
          <div class="mb-1 flex flex-col border-b border-sidebar-border/70 pb-1">
            <div class="px-0.5 pb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">Roots</div>
            <For each={props.roots}>
              {(root) => {
                const isActive = createMemo(() => activeRoot()?.id === root.id);
                const canToggle = createMemo(() => canToggleRootWrite(root));
                const saving = createMemo(() => permissionSavingRootID() === root.id);
                return (
                  <div
                    {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
                    data-filesystem-root-id={root.id}
                    data-filesystem-root-path={root.pathAbs}
                    class={cn(
                      'group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors',
                      isActive() ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-foreground hover:bg-sidebar-accent/60',
                    )}
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
                      title={root.pathAbs}
                      aria-current={isActive() ? 'page' : undefined}
                      onClick={() => props.onRootSelect?.(root.pathAbs)}
                    >
                      <span class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                        <FileItemIcon item={{ name: root.label, type: 'folder' }} class="h-3.5 w-3.5" />
                      </span>
                      <span class="min-w-0 flex-1 truncate">{root.label}</span>
                    </button>
                    <Show
                      when={canToggle()}
                      fallback={(
                        <span
                          data-filesystem-root-write-badge={root.id}
                          class={cn(
                            'h-5 shrink-0 rounded-md border px-1.5 text-[8px] font-semibold leading-4 shadow-sm',
                            root.permissions.write
                              ? 'border-primary/35 bg-primary/[0.16] text-primary shadow-primary/10'
                              : 'border-border/50 bg-muted/60 text-muted-foreground',
                          )}
                          title={`${root.label} is ${root.permissions.write ? 'read-write' : 'read-only'}`}
                        >
                          {root.permissions.write ? 'RW' : 'RO'}
                        </span>
                      )}
                    >
                      <div
                        data-filesystem-root-write-toggle={root.id}
                        class={cn(
                          'grid h-5 shrink-0 grid-cols-2 overflow-hidden rounded-md border border-border/60 bg-muted/60 p-0.5 text-[8px] font-semibold leading-4 shadow-inner shadow-black/10',
                          saving() && 'opacity-70',
                        )}
                        aria-label={`${root.label} filesystem access: ${root.permissions.write ? 'read-write' : 'read-only'}`}
                        role="group"
                        title={rootWriteToggleTitle(root)}
                      >
                        <button
                          type="button"
                          class={cn(
                            'h-4 min-w-[1.45rem] rounded px-1 text-[8px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset',
                            !root.permissions.write && !saving()
                              ? 'bg-foreground text-background shadow-sm shadow-black/20'
                              : 'cursor-pointer text-muted-foreground/65 hover:bg-background/80 hover:text-foreground',
                            saving() && 'cursor-default',
                          )}
                          aria-label={`Set ${root.label} to read-only`}
                          aria-pressed={!root.permissions.write}
                          disabled={saving()}
                          onClick={(event) => requestRootWriteToggle(event, root, false)}
                        >
                          {saving() ? '...' : 'RO'}
                        </button>
                        <button
                          type="button"
                          class={cn(
                            'h-4 min-w-[1.45rem] rounded px-1 text-[8px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset',
                            root.permissions.write && !saving()
                              ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                              : 'cursor-pointer text-muted-foreground/65 hover:bg-background/80 hover:text-primary',
                            saving() && 'cursor-default',
                          )}
                          aria-label={`Set ${root.label} to read-write`}
                          aria-pressed={root.permissions.write}
                          disabled={saving()}
                          onClick={(event) => requestRootWriteToggle(event, root, true)}
                        >
                          {saving() ? '...' : 'RW'}
                        </button>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
        <Show
          when={rootFolders().length > 0}
          fallback={<div class="px-0.5 py-1.5 text-[11px] text-muted-foreground">No folders in this location.</div>}
        >
          <div class="flex flex-col pb-0.5">
            <For each={rootFolders()}>
              {(item) => (
                <FileBrowserSidebarTreeRow
                  item={item}
                  depth={0}
                  instanceId={props.instanceId}
                  enableDragDrop={Boolean(props.enableDragDrop)}
                  registerRow={registerRow}
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <ConfirmDialog
        open={Boolean(confirmTarget())}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget()?.kind === 'computer' ? 'Enable write access for Computer?' : 'Allow filesystem writes?'}
        confirmText={confirmTarget()?.kind === 'computer' ? 'Enable RW' : 'Allow writes'}
        variant="destructive"
        loading={Boolean(confirmTarget() && permissionSavingRootID() === confirmTarget()?.id)}
        onConfirm={() => void confirmRootWriteAccess()}
      >
        <div class="space-y-3">
          <Show
            when={confirmTarget()?.kind === 'computer'}
            fallback={<p class="text-sm">This root will allow create, rename, overwrite, and delete operations from Redeven file capabilities.</p>}
          >
            <p class="text-sm">Redeven will be allowed to create, rename, delete, and overwrite files anywhere under / that your OS user can write.</p>
            <p class="text-xs text-muted-foreground">System permission prompts and OS restrictions still apply.</p>
          </Show>
          <p class="break-all text-xs text-muted-foreground">
            Root: {confirmTarget()?.label || confirmTarget()?.id || 'Filesystem Root'}
          </p>
          <p class="break-all text-xs text-muted-foreground">
            Path: <span class="font-mono">{confirmTarget()?.pathAbs || '-'}</span>
          </p>
          <p class="text-xs text-muted-foreground">
            The effective permission still intersects with the runtime permission policy, session capability, and OS-level filesystem permissions.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
