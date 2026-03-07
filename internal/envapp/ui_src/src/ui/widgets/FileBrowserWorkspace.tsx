import { Show, onCleanup, onMount } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { Menu, Search, ArrowUp } from '@floegence/floe-webapp-core/icons';
import {
  Breadcrumb,
  DirectoryTree,
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
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
  onNavigate?: (path: string) => void;
  onPathChange?: (path: string, source: 'user' | 'programmatic') => void;
  onOpen?: (item: FileItem) => void;
  onDragMove?: (items: FileItem[], targetPath: string) => void;
  contextMenuCallbacks?: ContextMenuCallbacks;
  overrideContextMenuItems?: ContextMenuItem[];
  class?: string;
}

function FileWorkspaceHeader(props: { showSidebarToggle?: boolean; onOpenSidebar?: () => void }) {
  const browser = useFileBrowser();
  const canNavigateUp = () => {
    const path = browser.currentPath();
    return path !== '/' && path !== '';
  };

  return (
    <div class={cn('shrink-0 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85', props.showSidebarToggle && 'pl-14')}>
      <Show when={props.showSidebarToggle}>
        <Button
          size="xs"
          variant="outline"
          icon={Menu}
          class="absolute left-3 top-3 z-10 h-7 w-7 bg-background/95 px-0 shadow-sm backdrop-blur-sm"
          aria-label="Open browser sidebar"
          title="Open browser sidebar"
          onClick={props.onOpenSidebar}
        />
      </Show>

      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" icon={ArrowUp} onClick={browser.navigateUp} disabled={!canNavigateUp()}>
            Up
          </Button>

          <div class="min-w-0 flex-1 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
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

        <label class="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
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
      </div>
    </div>
  );
}

function FileWorkspaceStatusBar() {
  const browser = useFileBrowser();

  return (
    <div class="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-1 text-[10px] text-muted-foreground">
      <div class="truncate">
        {browser.currentFiles().length} items
        <Show when={browser.filterQueryApplied().trim()}>
          <span> (filtered)</span>
        </Show>
        <Show when={browser.selectedItems().size > 0}>
          <span> · {browser.selectedItems().size} selected</span>
        </Show>
      </div>
      <div class="max-w-[40%] truncate">{browser.currentPath()}</div>
    </div>
  );
}

function FileBrowserWorkspaceInner(props: Omit<FileBrowserWorkspaceProps, 'files' | 'currentPath' | 'initialPath' | 'persistenceKey' | 'resetKey'>) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const dragEnabled = () => Boolean(drag && props.onDragMove);
  let contentScrollEl: HTMLDivElement | null = null;
  let sidebarScrollEl: HTMLDivElement | null = null;

  onMount(() => {
    if (!dragEnabled() || !drag) return;
    drag.registerInstance({
      instanceId: props.instanceId,
      currentPath: browser.currentPath,
      files: browser.files,
      onDragMove: props.onDragMove ? (items, targetPath) => props.onDragMove?.(items, targetPath) : undefined,
      getScrollContainer: () => contentScrollEl,
      getSidebarScrollContainer: () => sidebarScrollEl,
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
      headerActions={<span class="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Files</span>}
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      bodyRef={(el) => {
        sidebarScrollEl = el;
      }}
      modeSwitcher={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={props.gitHistoryDisabled} class="w-full" />}
      sidebarBody={(
        <div class="space-y-2">
          <div class="flex items-center justify-between px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
            <span>Folders</span>
            <span>{browser.currentPath() === '/' ? 'Root' : 'Tree'}</span>
          </div>
          <DirectoryTree instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="min-h-0" />
        </div>
      )}
      content={(
        <div class="flex h-full min-h-0 flex-col bg-background">
          <FileWorkspaceHeader showSidebarToggle={props.showSidebarToggle} onOpenSidebar={props.onOpenSidebar} />
          <div
            ref={(el) => {
              contentScrollEl = el;
              browser.setScrollContainer(el);
            }}
            class="flex-1 min-h-0 overflow-auto"
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
        showSidebarToggle={props.showSidebarToggle}
        onOpenSidebar={props.onOpenSidebar}
        onDragMove={props.onDragMove}
        contextMenuCallbacks={props.contextMenuCallbacks}
        overrideContextMenuItems={props.overrideContextMenuItems}
        class={props.class}
      />
    </FileBrowserProvider>
  );
}
