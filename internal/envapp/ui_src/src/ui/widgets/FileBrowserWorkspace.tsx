import { Show, onCleanup, onMount } from 'solid-js';
import { useFileBrowserDrag } from '@floegence/floe-webapp-core';
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
import { FileBrowserSidebarTree } from './FileBrowserSidebarTree';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';

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
    <div class="shrink-0 border-b border-border/60 bg-background/95 px-2.5 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/90">
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

        <div class="min-w-0 flex-1 rounded-md border border-border/50 bg-background px-2.5 py-1.5 shadow-sm">
          <Breadcrumb class="min-w-0" />
        </div>

        <label class="flex min-w-[200px] flex-1 items-center gap-1.5 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring sm:max-w-[15rem] sm:flex-none">
          <Search class="size-3.5 shrink-0" />
          <input
            type="text"
            value={browser.filterQuery()}
            onInput={(event) => browser.setFilterQuery(event.currentTarget.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            class="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </label>

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

      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{browser.currentFiles().length} visible</span>
        <Show when={browser.selectedItems().size > 0}>
          <>
            <span aria-hidden="true">·</span>
            <span class="text-primary/80">{browser.selectedItems().size} selected</span>
          </>
        </Show>
        <Show when={browser.filterQueryApplied().trim()}>
          <>
            <span aria-hidden="true">·</span>
            <span>Filter active</span>
          </>
        </Show>
      </div>
    </div>
  );
}

function FileWorkspaceStatusBar() {
  const browser = useFileBrowser();

  return (
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground">
      <div class="flex flex-wrap items-center gap-1.5">
        <span>{browser.currentFiles().length} items</span>
        <Show when={browser.filterQueryApplied().trim()}>
          <>
            <span aria-hidden="true">·</span>
            <span>Filtered view</span>
          </>
        </Show>
        <Show when={browser.selectedItems().size > 0}>
          <>
            <span aria-hidden="true">·</span>
            <span class="text-primary/80">{browser.selectedItems().size} selected</span>
          </>
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
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      sidebarBodyClass="overflow-hidden"
      modeSwitcher={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={props.gitHistoryDisabled} class="w-full" />}
      sidebarBody={(
        <div class="flex h-full min-h-0 flex-col gap-1.5">
          <div class="flex items-center justify-between px-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
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
            <FileBrowserSidebarTree
              instanceId={props.instanceId}
              enableDragDrop={dragEnabled()}
              sidebarOpen={props.open}
              scrollContainer={() => treeScrollEl}
              class="min-h-full"
            />
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
              <FileListView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full redeven-file-list-compact" />
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
        width={props.width}
        open={props.open}
        resizable={props.resizable}
        onResize={props.onResize}
        onClose={props.onClose}
        showMobileSidebarButton={props.showMobileSidebarButton}
        onToggleSidebar={props.onToggleSidebar}
        instanceId={props.instanceId}
        onDragMove={props.onDragMove}
        contextMenuCallbacks={props.contextMenuCallbacks}
        overrideContextMenuItems={props.overrideContextMenuItems}
        class={props.class}
      />
    </FileBrowserProvider>
  );
}
