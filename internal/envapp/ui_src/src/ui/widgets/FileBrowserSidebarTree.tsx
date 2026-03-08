import { For, Show, createEffect, createMemo, onCleanup } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import { FolderIcon, FolderOpenIcon, useFileBrowser, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { gitToneBadgeClass, gitToneInsetClass } from './GitChrome';

const MAX_VISIBLE_DEPTH = 5;
const TREE_ROW_BASE_PADDING = 8;
const TREE_ROW_DEPTH_STEP = 14;

function getPathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function getPathDepth(path: string): number {
  return getPathSegments(path).length;
}

function getPathLeaf(path: string): string {
  const segments = getPathSegments(path);
  return segments.at(-1) ?? 'Root';
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

export interface FileBrowserCurrentFolderCardProps {
  class?: string;
}

export function FileBrowserCurrentFolderCard(props: FileBrowserCurrentFolderCardProps) {
  const browser = useFileBrowser();
  const rootFolders = createMemo(() => browser.files().filter((item) => item.type === 'folder'));
  const folderIndex = createMemo(() => buildFolderIndex(browser.files()));
  const currentFolder = createMemo(() => {
    const path = browser.currentPath();
    if (path === '/') return null;
    return folderIndex().get(path) ?? null;
  });
  const currentDepth = createMemo(() => getPathDepth(browser.currentPath()));
  const currentLabel = createMemo(() => {
    const path = browser.currentPath();
    if (path === '/') return 'Root';
    return currentFolder()?.name ?? getPathLeaf(path);
  });
  const currentFolderCount = createMemo(() => {
    if (browser.currentPath() === '/') return rootFolders().length;
    return getFolderChildren(currentFolder()).length;
  });
  const folderCountLabel = createMemo(() => `${currentFolderCount()} folder${currentFolderCount() === 1 ? '' : 's'}`);

  return (
    <section
      data-testid="file-current-folder-summary"
      class={cn('rounded-xl border px-2.5 py-2 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]', gitToneInsetClass(currentDepth() > MAX_VISIBLE_DEPTH ? 'brand' : 'info'), props.class)}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Current Folder</div>
          <div class="mt-1 truncate text-[12px] font-semibold text-foreground" title={browser.currentPath() === '/' ? 'Repository root' : browser.currentPath()}>
            {currentLabel()}
          </div>
          <div class="mt-1 max-h-8 overflow-hidden break-all text-[10px] leading-4 text-muted-foreground">
            {browser.currentPath() === '/' ? 'Repository root' : browser.currentPath()}
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(currentDepth() > MAX_VISIBLE_DEPTH ? 'brand' : 'info'))}>
            Depth {currentDepth()}
          </span>
          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('neutral'))}>
            {folderCountLabel()}
          </span>
        </div>
      </div>
    </section>
  );
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
    <div class="space-y-0.5">
      <div class="py-0.5" style={{ 'padding-left': rowPaddingLeft() }}>
        <div
          class={cn(
            'flex items-center gap-1 rounded-lg border border-transparent bg-transparent transition-colors duration-150',
            isCurrent() && 'border-border/80 bg-muted/60 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]',
            !isCurrent() && 'hover:bg-muted/45',
            isDropTarget() && canAcceptDrop() && 'border-sky-500/30 bg-sky-500/[0.08]',
            isDropTarget() && !canAcceptDrop() && 'border-error/30 bg-error/10',
          )}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <Show
            when={hasChildren()}
            fallback={<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/45"><ChevronRight class="h-3.5 w-3.5 opacity-0" /></span>}
          >
            <button
              type="button"
              class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1"
              aria-label={isExpanded() ? 'Collapse folder' : 'Expand folder'}
              aria-expanded={isExpanded()}
              onClick={handleToggleExpand}
            >
              <ChevronRight class={cn('h-3.5 w-3.5 transition-transform duration-150', isExpanded() && 'rotate-90')} />
            </button>
          </Show>

          <button
            ref={(el) => {
              props.registerRow(props.item.path, el);
            }}
            type="button"
            data-tree-row-path={props.item.path}
            class="flex min-h-[36px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1"
            aria-current={isCurrent() ? 'page' : undefined}
            title={props.item.path}
            onClick={handleNavigate}
            onContextMenu={handleContextMenu}
          >
            <span class={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/85 text-muted-foreground', isCurrent() && 'text-foreground')}>
              <Show when={hasChildren() && isExpanded()} fallback={<FolderIcon class="h-3.5 w-3.5" />}>
                <FolderOpenIcon class="h-3.5 w-3.5" />
              </Show>
            </span>
            <span class="min-w-0 flex-1 truncate font-medium">{props.item.name}</span>
            <Show when={compactDepthOverflow() > 0}>
              <span class={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-medium', gitToneBadgeClass('neutral'))}>
                +{compactDepthOverflow()}
              </span>
            </Show>
          </button>
        </div>
      </div>

      <Show when={hasChildren() && isExpanded()}>
        <div class="space-y-0.5">
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
        fallback={(
          <div class={cn('rounded-xl border px-2.5 py-2 text-[11px] text-muted-foreground', gitToneInsetClass('neutral'))}>
            No folders in this location.
          </div>
        )}
      >
        <div class="space-y-0.5 pb-1">
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
