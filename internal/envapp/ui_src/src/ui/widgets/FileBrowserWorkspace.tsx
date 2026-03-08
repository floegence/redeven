import { Show, onCleanup, onMount } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, Search, ArrowUp } from '@floegence/floe-webapp-core/icons';
import {
  Breadcrumb,
  FileBrowserProvider,
  FileContextMenu,
  FileGridView,
  FileListView,
  useFileBrowser,
  type ContextMenuCallbacks,
  type ContextMenuItem,
  type FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { Button, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { FileBrowserCurrentFolderCard, FileBrowserSidebarTree } from './FileBrowserSidebarTree';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { gitToneBadgeClass, gitToneInsetClass } from './GitChrome';

export interface FileBrowserWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  files: FileItem[];
  currentPath: string;
  initialPath: string;
  persistenceKey?: string;
  instanceId: string;
  resetKey: number;
  width?: number;
  open?: boolean;
  resizable?: boolean;
  onResize?: (delta: number) => void;
  onClose?: () => void;
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
  onNavigate?: (path: string) => void;
  onPathChange?: (path: string, source: 'user' | 'programmatic') => void;
  onOpen?: (item: FileItem) => void;
  onDragMove?: (items: FileItem[], targetPath: string) => void;
  contextMenuCallbacks?: ContextMenuCallbacks;
  overrideContextMenuItems?: ContextMenuItem[];
  class?: string;
}

interface FileWorkspaceHeaderProps {
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
}

function FileWorkspaceHeader(props: FileWorkspaceHeaderProps) {
  const browser = useFileBrowser();
  const canNavigateUp = () => {
    const path = browser.currentPath();
    return path !== '/' && path !== '';
  };

  return (
    <div class="shrink-0 border-b border-border/70 bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <Show when={props.showMobileSidebarButton && props.onToggleSidebar}>
            <Button
              size="xs"
              variant="outline"
              icon={FilesIcon}
              class="cursor-pointer"
              aria-label="Toggle browser sidebar"
              onClick={props.onToggleSidebar}
            >
              Sidebar
            </Button>
          </Show>

          <Button size="xs" variant="outline" icon={ArrowUp} class="cursor-pointer" onClick={browser.navigateUp} disabled={!canNavigateUp()}>
            Up
          </Button>

          <div class={cn('min-w-0 flex-1 rounded-xl border px-3 py-2', gitToneInsetClass('info'))}>
            <Breadcrumb class="min-w-0" />
          </div>

          <SegmentedControl
            size="sm"
            value={browser.viewMode()}
            onChange={(value) => browser.setViewMode(value === 'grid' ? 'grid' : 'list')}
            options={[
              { value: 'list', label: 'List' },
              { value: 'grid', label: 'Grid' },
            ]}
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <label class="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            <Search class="size-3.5 shrink-0" />
            <input
              type="text"
              value={browser.filterQuery()}
              onInput={(event) => browser.setFilterQuery(event.currentTarget.value)}
              placeholder="Filter files"
              aria-label="Filter files"
              class="min-w-0 flex-1 border-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </label>

          <span class={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium', gitToneBadgeClass('info'))}>
            {browser.currentFiles().length} visible
          </span>
          <Show when={browser.selectedItems().size > 0}>
            <span class={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium', gitToneBadgeClass('brand'))}>
              {browser.selectedItems().size} selected
            </span>
          </Show>
          <Show when={browser.filterQueryApplied().trim()}>
            <span class={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium', gitToneBadgeClass('warning'))}>
              Filter active
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}

function FileWorkspaceStatusBar() {
  const browser = useFileBrowser();

  return (
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
      <div class="flex flex-wrap items-center gap-2">
        <span class={cn('inline-flex items-center rounded-full border px-2 py-1 font-medium', gitToneBadgeClass('neutral'))}>
          {browser.currentFiles().length} items
        </span>
        <Show when={browser.filterQueryApplied().trim()}>
          <span class={cn('inline-flex items-center rounded-full border px-2 py-1 font-medium', gitToneBadgeClass('warning'))}>
            Filtered view
          </span>
        </Show>
        <Show when={browser.selectedItems().size > 0}>
          <span class={cn('inline-flex items-center rounded-full border px-2 py-1 font-medium', gitToneBadgeClass('brand'))}>
            {browser.selectedItems().size} selected
          </span>
        </Show>
      </div>
      <div class="max-w-full truncate text-right sm:max-w-[45%]">{browser.currentPath()}</div>
    </div>
  );
}

function FileBrowserWorkspaceInner(props: Omit<FileBrowserWorkspaceProps, 'files' | 'currentPath' | 'initialPath' | 'persistenceKey' | 'resetKey'>) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const dragEnabled = () => Boolean(drag && props.onDragMove);
  let contentScrollEl: HTMLDivElement | null = null;
  let treeScrollEl: HTMLDivElement | null = null;

  onMount(() => {
    if (!dragEnabled() || !drag) return;
    drag.registerInstance({
      instanceId: props.instanceId,
      currentPath: browser.currentPath,
      files: browser.files,
      onDragMove: props.onDragMove ? (items, targetPath) => props.onDragMove?.(items, targetPath) : undefined,
      getScrollContainer: () => contentScrollEl,
      getSidebarScrollContainer: () => treeScrollEl,
      optimisticRemove: browser.optimisticRemove,
      optimisticInsert: browser.optimisticInsert,
    });
  });

  onCleanup(() => {
    if (!drag) return;
    drag.unregisterInstance(props.instanceId);
  });

  return (
    <BrowserWorkspaceShell
      title="Browser"
      headerActions={<span class={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]', gitToneBadgeClass('info'))}>Files</span>}
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      sidebarBodyClass="overflow-hidden"
      modeSwitcher={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={props.gitHistoryDisabled} class="w-full" />}
      sidebarBody={(
        <div class="flex h-full min-h-0 flex-col gap-1.5">
          <FileBrowserCurrentFolderCard />

          <div class="flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
            <span>Folder Tree</span>
            <span>{browser.currentPath() === '/' ? 'Root' : 'Compact depth'}</span>
          </div>

          <div
            ref={(el) => {
              treeScrollEl = el;
            }}
            data-testid="file-tree-scroll-region"
            class="min-h-0 flex-1 overflow-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
          >
            <div class={cn('min-h-full rounded-lg border p-1.5', gitToneInsetClass('neutral'))}>
              <FileBrowserSidebarTree
                instanceId={props.instanceId}
                enableDragDrop={dragEnabled()}
                sidebarOpen={props.open}
                scrollContainer={() => treeScrollEl}
                class="min-h-full"
              />
            </div>
          </div>
        </div>
      )}
      content={(
        <div class="flex h-full min-h-0 flex-col bg-background">
          <FileWorkspaceHeader
            showMobileSidebarButton={props.showMobileSidebarButton}
            onToggleSidebar={props.onToggleSidebar}
          />
          <div
            ref={(el) => {
              contentScrollEl = el;
              browser.setScrollContainer(el);
            }}
            class="min-h-0 flex-1 overflow-auto bg-background"
          >
            <Show when={browser.viewMode() === 'list'} fallback={<FileGridView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full" />}>
              <FileListView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full" />
            </Show>
          </div>
          <FileWorkspaceStatusBar />
          <FileContextMenu callbacks={props.contextMenuCallbacks} overrideItems={props.overrideContextMenuItems} />
        </div>
      )}
      class={props.class}
    />
  );
}

export function FileBrowserWorkspace(props: FileBrowserWorkspaceProps) {
  void props.resetKey;

  return (
    <FileBrowserProvider
      files={props.files}
      path={props.currentPath}
      initialPath={props.initialPath}
      initialViewMode="list"
      persistenceKey={props.persistenceKey}
      homeLabel="Home"
      onNavigate={props.onNavigate}
      onPathChange={props.onPathChange}
      onOpen={props.onOpen}
    >
      <FileBrowserWorkspaceInner
        mode={props.mode}
        onModeChange={props.onModeChange}
        gitHistoryDisabled={props.gitHistoryDisabled}
        instanceId={props.instanceId}
        width={props.width}
        open={props.open}
        resizable={props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        showMobileSidebarButton={props.showMobileSidebarButton}
        onToggleSidebar={props.onToggleSidebar}
        onDragMove={props.onDragMove}
        contextMenuCallbacks={props.contextMenuCallbacks}
        overrideContextMenuItems={props.overrideContextMenuItems}
        class={props.class}
      />
    </FileBrowserProvider>
  );
}
