import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, Search, ArrowUp } from '@floegence/floe-webapp-core/icons';
import {
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
import { FileBrowserPathBreadcrumb } from './FileBrowserPathBreadcrumb';
import { FileBrowserSidebarTree } from './FileBrowserSidebarTree';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { useFileBrowserTypeToFilter } from './fileBrowserTypeToFilter';
import { resolveFileBrowserToolbarLayout } from './fileBrowserPathLayout';
import {
  mapContextMenuCallbacksToAbsolute,
  mapContextMenuItemsToAbsolute,
  mapFileItemToAbsolutePath,
  mapFileItemsToDisplayPath,
  toFileBrowserAbsolutePath,
  toFileBrowserDisplayPath,
} from '../utils/fileBrowserDisplayPath';

const FILE_WORKSPACE_TOOLBAR_FIELD_CLASS =
  'h-7 min-w-0 rounded-md border border-border/50 bg-background px-2.5 shadow-sm';
const FILE_WORKSPACE_TOOLBAR_SEGMENTED_CLASS =
  'h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:py-0';
const FILE_WORKSPACE_TOOLBAR_PATH_CLASS = `${FILE_WORKSPACE_TOOLBAR_FIELD_CLASS} flex items-center`;
const FILE_WORKSPACE_TOOLBAR_FILTER_CLASS =
  `${FILE_WORKSPACE_TOOLBAR_FIELD_CLASS} flex items-center gap-1.5 text-[11px] text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring`;

export interface FileBrowserWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  captureTypingFromPage?: boolean;
  files: FileItem[];
  currentPath: string;
  initialPath: string;
  homePath?: string;
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
  toolbarEndActions?: JSX.Element;
  contextMenuCallbacks?: ContextMenuCallbacks;
  overrideContextMenuItems?: ContextMenuItem[];
  class?: string;
}

interface FileWorkspaceHeaderProps {
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
  toolbarEndActions?: JSX.Element;
  filterInputRef?: (el: HTMLInputElement) => void;
}

function FileWorkspaceHeader(props: FileWorkspaceHeaderProps) {
  const browser = useFileBrowser();
  let toolbarLayoutRef: HTMLDivElement | undefined;
  const [toolbarWidth, setToolbarWidth] = createSignal(0);
  const canNavigateUp = () => {
    const path = browser.currentPath();
    return path !== '/' && path !== '';
  };
  const toolbarLayout = createMemo(() => resolveFileBrowserToolbarLayout(toolbarWidth()));

  onMount(() => {
    const syncToolbarWidth = () => {
      setToolbarWidth(toolbarLayoutRef?.offsetWidth ?? 0);
    };

    syncToolbarWidth();

    if (typeof ResizeObserver === 'undefined' || !toolbarLayoutRef) return;

    const observer = new ResizeObserver(() => {
      syncToolbarWidth();
    });
    observer.observe(toolbarLayoutRef);

    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="shrink-0 border-b border-border/60 bg-background/95 px-2.5 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div
        ref={toolbarLayoutRef}
        data-toolbar-layout={toolbarLayout()}
        class={cn(
          'grid items-center gap-2',
          toolbarLayout() === 'inline'
            ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
            : 'grid-cols-[auto_minmax(0,1fr)]'
        )}
      >
        <div class="flex shrink-0 items-center gap-2">
          <Show when={props.showMobileSidebarButton && props.onToggleSidebar}>
            <Button
              size="sm"
              variant="outline"
              icon={FilesIcon}
              class="cursor-pointer"
              aria-label="Toggle browser sidebar"
              onClick={props.onToggleSidebar}
            >
              Sidebar
            </Button>
          </Show>

          <Button size="sm" variant="outline" icon={ArrowUp} class="cursor-pointer" onClick={browser.navigateUp} disabled={!canNavigateUp()}>
            Up
          </Button>
        </div>

        <div class={FILE_WORKSPACE_TOOLBAR_PATH_CLASS}>
          <FileBrowserPathBreadcrumb class="min-w-0 flex-1" />
        </div>

        <div
          class={cn(
            'flex min-w-0 items-center gap-1.5',
            toolbarLayout() === 'inline'
              ? 'justify-self-end'
              : 'col-span-2 flex-wrap'
          )}
        >
          <label
            class={cn(
              FILE_WORKSPACE_TOOLBAR_FILTER_CLASS,
              toolbarLayout() === 'inline'
                ? 'w-[15rem] min-w-[200px]'
                : 'min-w-[220px] flex-1 basis-[220px]'
            )}
          >
            <Search class="size-3.5 shrink-0" />
            <input
              ref={props.filterInputRef}
              type="text"
              value={browser.filterQuery()}
              onInput={(event) => browser.setFilterQuery(event.currentTarget.value)}
              placeholder="Filter files"
              aria-label="Filter files"
              class="h-full min-w-0 flex-1 border-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70"
            />
          </label>

          <div class="flex shrink-0 items-center gap-1.5">
            <SegmentedControl
              size="sm"
              class={FILE_WORKSPACE_TOOLBAR_SEGMENTED_CLASS}
              value={browser.viewMode()}
              onChange={(value) => browser.setViewMode(value === 'grid' ? 'grid' : 'list')}
              options={[
                { value: 'list', label: 'List' },
                { value: 'grid', label: 'Grid' },
              ]}
            />

            <Show when={props.toolbarEndActions}>
              <div class="flex items-center gap-1">{props.toolbarEndActions}</div>
            </Show>
          </div>
        </div>
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
      <div class="max-w-full truncate text-right sm:max-w-[45%]">
        {browser.currentPath() === '/' ? browser.homeLabel() : browser.currentPath()}
      </div>
    </div>
  );
}

function FileBrowserWorkspaceInner(props: Omit<FileBrowserWorkspaceProps, 'files' | 'currentPath' | 'initialPath' | 'persistenceKey' | 'resetKey'>) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const dragEnabled = () => Boolean(drag && props.onDragMove);
  let contentScrollEl: HTMLDivElement | null = null;
  let treeScrollEl: HTMLDivElement | null = null;
  let workspaceRootEl: HTMLDivElement | null = null;
  let filterInputEl: HTMLInputElement | null = null;

  useFileBrowserTypeToFilter({
    rootRef: () => workspaceRootEl,
    filterInputRef: () => filterInputEl,
    enabled: () => props.mode === 'files',
    captureWhenBodyFocused: () => props.captureTypingFromPage === true,
  });

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
            <span>{browser.currentPath() === '/' ? browser.homeLabel() : 'Compact depth'}</span>
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
        <div
          ref={(el) => {
            workspaceRootEl = el;
          }}
          tabindex={-1}
          class="flex h-full min-h-0 flex-col bg-background focus:outline-none"
        >
          <FileWorkspaceHeader
            showMobileSidebarButton={props.showMobileSidebarButton}
            onToggleSidebar={props.onToggleSidebar}
            toolbarEndActions={props.toolbarEndActions}
            filterInputRef={(el) => {
              filterInputEl = el;
            }}
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
  const displayFiles = createMemo(() => mapFileItemsToDisplayPath(props.files, props.homePath));
  const displayCurrentPath = createMemo(() => toFileBrowserDisplayPath(props.currentPath, props.homePath));
  const displayInitialPath = createMemo(() => toFileBrowserDisplayPath(props.initialPath, props.homePath));
  const displayContextMenuCallbacks = createMemo(() => mapContextMenuCallbacksToAbsolute(props.contextMenuCallbacks, props.homePath));
  const displayOverrideContextMenuItems = createMemo(() => mapContextMenuItemsToAbsolute(props.overrideContextMenuItems, props.homePath));

  const toAbsolutePath = (path: string): string => {
    return toFileBrowserAbsolutePath(path, props.homePath) || props.currentPath || props.homePath || '';
  };

  return (
    <Show when={props.resetKey + 1} keyed>
      <FileBrowserProvider
        files={displayFiles()}
        path={displayCurrentPath()}
        initialPath={displayInitialPath()}
        initialViewMode="grid"
        persistenceKey={props.persistenceKey}
        homeLabel="Home"
        onNavigate={(path) => props.onNavigate?.(toAbsolutePath(path))}
        onPathChange={(path, source) => props.onPathChange?.(toAbsolutePath(path), source)}
        onOpen={(item) => props.onOpen?.(mapFileItemToAbsolutePath(item, props.homePath))}
      >
        <FileBrowserWorkspaceInner
          mode={props.mode}
          onModeChange={props.onModeChange}
          gitHistoryDisabled={props.gitHistoryDisabled}
          captureTypingFromPage={props.captureTypingFromPage}
          width={props.width}
          open={props.open}
          resizable={props.resizable}
          onResize={props.onResize}
          onClose={props.onClose}
          showMobileSidebarButton={props.showMobileSidebarButton}
          onToggleSidebar={props.onToggleSidebar}
          instanceId={props.instanceId}
          onDragMove={props.onDragMove
            ? (items, targetPath) => props.onDragMove?.(
                items.map((item) => mapFileItemToAbsolutePath(item, props.homePath)),
                toAbsolutePath(targetPath),
              )
            : undefined}
          toolbarEndActions={props.toolbarEndActions}
          contextMenuCallbacks={displayContextMenuCallbacks()}
          overrideContextMenuItems={displayOverrideContextMenuItems()}
          class={props.class}
        />
      </FileBrowserProvider>
    </Show>
  );
}
