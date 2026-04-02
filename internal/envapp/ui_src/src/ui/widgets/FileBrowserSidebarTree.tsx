import { For, Show, createEffect, createMemo, onCleanup } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FileItemIcon, useFileBrowser, type FileItem } from '@floegence/floe-webapp-core/file-browser';

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

  return (
    <div class={cn('flex min-h-full flex-col', props.class)}>
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
  );
}
