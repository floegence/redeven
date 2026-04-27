import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, useFileBrowserDrag } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, Search, ArrowUp } from '@floegence/floe-webapp-core/icons';
import {
  FileBrowserDragPreview,
  FileBrowserProvider,
  type FileBrowserRevealRequest,
  FileContextMenu,
  FileGridView,
  FileListView,
  useFileBrowser,
  type ContextMenuEvent,
  type ContextMenuCallbacks,
  type ContextMenuItem,
  type FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { Button, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { FileBrowserPathControl, type FileBrowserPathControlMode } from './FileBrowserPathControl';
import { FileBrowserSidebarTree } from './FileBrowserSidebarTree';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { useFileBrowserTypeToFilter } from './fileBrowserTypeToFilter';
import { resolveFileBrowserToolbarLayout } from './fileBrowserPathLayout';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { formatFileBrowserPathInputValue, parseFileBrowserPathInput } from '../utils/fileBrowserPathInput';
import {
  mapContextMenuCallbacksToAbsolute,
  mapContextMenuEventToAbsolutePath,
  mapContextMenuItemsToAbsolute,
  mapFileItemToAbsolutePath,
  mapFileItemsToDisplayPath,
  mapRevealRequestToDisplayPath,
  toFileBrowserAbsolutePath,
  toFileBrowserDisplayPath,
} from '../utils/fileBrowserDisplayPath';

const FILE_WORKSPACE_TOOLBAR_FIELD_CLASS =
  cn('h-7 min-w-0 rounded-md border px-2.5 shadow-sm', redevenSurfaceRoleClass('control'), redevenSurfaceRoleClass('controlMuted'));
const FILE_WORKSPACE_TOOLBAR_SEGMENTED_CLASS =
  cn('h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:py-0', redevenSurfaceRoleClass('segmented'));
const FILE_WORKSPACE_TOOLBAR_PATH_CLASS = `${FILE_WORKSPACE_TOOLBAR_FIELD_CLASS} flex items-center`;
const FILE_WORKSPACE_TOOLBAR_FILTER_CLASS =
  `${FILE_WORKSPACE_TOOLBAR_FIELD_CLASS} flex items-center gap-1.5 text-[11px] text-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-ring`;
const FILE_WORKSPACE_OUTLINE_CONTROL_CLASS = cn('cursor-pointer', redevenSurfaceRoleClass('control'));

export type FileBrowserPathSubmitResult =
  | { status: 'ready' | 'refreshed'; committedPath: string }
  | { status: 'error'; message: string };

export interface FileBrowserWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  gitHistoryDisabledReason?: string;
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
  onPathSubmit?: (path: string) => Promise<FileBrowserPathSubmitResult>;
  onOpen?: (item: FileItem) => void;
  onDragMove?: (items: FileItem[], targetPath: string) => void;
  revealRequest?: FileBrowserRevealRequest | null;
  onRevealRequestConsumed?: (requestId: string) => void;
  pathEditRequestKey?: number;
  toolbarEndActions?: JSX.Element;
  contextMenuCallbacks?: ContextMenuCallbacks;
  overrideContextMenuItems?: ContextMenuItem[];
  resolveOverrideContextMenuItems?: (event: ContextMenuEvent | null) => ContextMenuItem[] | undefined;
  class?: string;
}

interface FileWorkspaceHeaderProps {
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
  toolbarEndActions?: JSX.Element;
  filterInputRef?: (el: HTMLInputElement) => void;
  pathInputRef?: (el: HTMLInputElement) => void;
  pathControlMode: FileBrowserPathControlMode;
  pathDraft: string;
  pathError?: string;
  pathSubmitting?: boolean;
  pathStatusTone?: 'muted' | 'error';
  pathStatusText?: string;
  onPathDraftChange: (value: string) => void;
  onActivatePathEdit: () => void;
  onSubmitPath: () => void;
  onCancelPathEdit: () => void;
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
    <div class={cn('shrink-0 border-b px-2.5 py-1.5', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}>
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
              class={FILE_WORKSPACE_OUTLINE_CONTROL_CLASS}
              aria-label="Toggle browser sidebar"
              onClick={props.onToggleSidebar}
            >
              Sidebar
            </Button>
          </Show>

          <Button size="sm" variant="outline" icon={ArrowUp} class={FILE_WORKSPACE_OUTLINE_CONTROL_CLASS} onClick={browser.navigateUp} disabled={!canNavigateUp()}>
            Up
          </Button>
        </div>

        <div class={FILE_WORKSPACE_TOOLBAR_PATH_CLASS}>
          <FileBrowserPathControl
            class="min-w-0 flex-1"
            mode={props.pathControlMode}
            draft={props.pathDraft}
            error={props.pathError}
            submitting={props.pathSubmitting}
            inputRef={props.pathInputRef}
            onDraftChange={props.onPathDraftChange}
            onActivateEdit={props.onActivatePathEdit}
            onSubmit={props.onSubmitPath}
            onCancel={props.onCancelPathEdit}
          />
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
        <Show when={props.pathStatusText?.trim()}>
          <>
            <span aria-hidden="true">·</span>
            <span class={props.pathStatusTone === 'error' ? 'text-destructive' : undefined}>{props.pathStatusText}</span>
          </>
        </Show>
      </div>
    </div>
  );
}

function FileWorkspaceStatusBar() {
  const browser = useFileBrowser();

  return (
    <div class={cn('flex flex-wrap items-center justify-between gap-2 border-t px-2.5 py-1 text-[10px] text-muted-foreground', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}>
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

function FileBrowserWorkspaceInner(props: Omit<FileBrowserWorkspaceProps, 'files' | 'initialPath' | 'persistenceKey' | 'resetKey'>) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const dragEnabled = () => Boolean(drag && props.onDragMove);
  const resolvedOverrideContextMenuItems = createMemo(() => {
    if (!props.resolveOverrideContextMenuItems) {
      return props.overrideContextMenuItems;
    }
    return props.resolveOverrideContextMenuItems(browser.contextMenu() ?? null);
  });
  let contentScrollEl: HTMLDivElement | null = null;
  let treeScrollEl: HTMLDivElement | null = null;
  let workspaceRootEl: HTMLDivElement | null = null;
  let filterInputEl: HTMLInputElement | null = null;
  let pathInputEl: HTMLInputElement | null = null;
  const [pathControlMode, setPathControlMode] = createSignal<FileBrowserPathControlMode>('read');
  const [pathDraft, setPathDraft] = createSignal('');
  const [pathError, setPathError] = createSignal('');
  const [pathSubmitting, setPathSubmitting] = createSignal(false);
  const formattedCurrentPath = createMemo(() => formatFileBrowserPathInputValue(props.currentPath, props.homePath));
  const pathStatus = createMemo(() => {
    if (pathControlMode() !== 'edit') return null;
    if (pathError().trim()) {
      return { tone: 'error' as const, text: pathError().trim() };
    }
    if (pathSubmitting()) {
      return { tone: 'muted' as const, text: 'Opening path...' };
    }
    return { tone: 'muted' as const, text: 'Enter to open · Esc to cancel' };
  });

  const focusPathInput = () => {
    requestAnimationFrame(() => {
      pathInputEl?.focus();
      pathInputEl?.select();
    });
  };

  const openPathEditor = () => {
    if (pathSubmitting()) return;
    setPathDraft(formattedCurrentPath());
    setPathError('');
    setPathControlMode('edit');
    focusPathInput();
  };

  const closePathEditor = () => {
    if (pathSubmitting()) return;
    setPathControlMode('read');
    setPathError('');
    setPathDraft(formattedCurrentPath());
  };

  const submitPathEditor = async () => {
    if (pathSubmitting()) return;

    const parsed = parseFileBrowserPathInput(pathDraft(), props.homePath);
    if (parsed.kind === 'error') {
      setPathError(parsed.message);
      focusPathInput();
      return;
    }

    if (!props.onPathSubmit) {
      browser.setCurrentPath(toFileBrowserDisplayPath(parsed.absolutePath, props.homePath));
      setPathControlMode('read');
      setPathError('');
      return;
    }

    setPathSubmitting(true);
    setPathError('');
    try {
      const result = await props.onPathSubmit(parsed.absolutePath);
      if (result.status === 'error') {
        setPathError(result.message);
        focusPathInput();
        return;
      }

      setPathControlMode('read');
      setPathError('');
    } finally {
      setPathSubmitting(false);
    }
  };

  useFileBrowserTypeToFilter({
    rootRef: () => workspaceRootEl,
    filterInputRef: () => filterInputEl,
    enabled: () => props.mode === 'files',
    captureWhenBodyFocused: () => props.captureTypingFromPage === true,
    openPathEditor,
    pathEditorActive: () => pathControlMode() === 'edit',
  });

  createEffect(() => {
    if (pathControlMode() === 'edit') return;
    setPathDraft(formattedCurrentPath());
    setPathError('');
  });

  createEffect(on(
    () => props.pathEditRequestKey,
    (requestKey) => {
      if (!requestKey) return;
      openPathEditor();
    },
  ));

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

  const handleWorkspaceBackgroundContextMenu = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button')) return;

    event.preventDefault();
    event.stopPropagation();
    browser.clearSelection();
    browser.showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [],
      targetKind: 'directory-background',
      source: 'background',
      directory: {
        path: browser.currentPath(),
      },
    });
  };

  return (
    <BrowserWorkspaceShell
      title="Browser"
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      sidebarBodyClass="overflow-hidden"
      modeSwitcher={(
        <GitHistoryModeSwitch
          mode={props.mode}
          onChange={props.onModeChange}
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          class="w-full"
        />
      )}
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
            {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
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
            pathControlMode={pathControlMode()}
            pathDraft={pathDraft()}
            pathError={pathError()}
            pathSubmitting={pathSubmitting()}
            pathStatusTone={pathStatus()?.tone}
            pathStatusText={pathStatus()?.text}
            pathInputRef={(el) => {
              pathInputEl = el;
            }}
            onPathDraftChange={setPathDraft}
            onActivatePathEdit={openPathEditor}
            onSubmitPath={() => { void submitPathEditor(); }}
            onCancelPathEdit={closePathEditor}
            filterInputRef={(el) => {
              filterInputEl = el;
            }}
          />
          <div
            ref={(el) => {
              contentScrollEl = el;
              browser.setScrollContainer(el);
            }}
            {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
            data-testid="file-browser-content-scroll-region"
            class="min-h-0 flex-1 overflow-auto bg-background"
            onContextMenu={handleWorkspaceBackgroundContextMenu}
          >
            <Show when={browser.viewMode() === 'list'} fallback={<FileGridView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full" />}>
              <FileListView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full redeven-file-list-compact" />
            </Show>
          </div>
          <FileWorkspaceStatusBar />
          <FileContextMenu callbacks={props.contextMenuCallbacks} overrideItems={resolvedOverrideContextMenuItems()} />
          <Show when={dragEnabled()}>
            <FileBrowserDragPreview />
          </Show>
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
  const displayRevealRequest = createMemo(() => mapRevealRequestToDisplayPath(props.revealRequest, props.homePath));
  const resolveDisplayOverrideContextMenuItems = (event: ContextMenuEvent | null) => (
    mapContextMenuItemsToAbsolute(
      props.resolveOverrideContextMenuItems?.(
        mapContextMenuEventToAbsolutePath(event, props.homePath),
      ),
      props.homePath,
    )
  );

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
        revealRequest={displayRevealRequest()}
        onRevealRequestConsumed={props.onRevealRequestConsumed}
      >
        <FileBrowserWorkspaceInner
          mode={props.mode}
          onModeChange={props.onModeChange}
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          captureTypingFromPage={props.captureTypingFromPage}
          currentPath={props.currentPath}
          homePath={props.homePath}
          width={props.width}
          open={props.open}
          resizable={props.resizable}
          onResize={props.onResize}
          onClose={props.onClose}
          showMobileSidebarButton={props.showMobileSidebarButton}
          onToggleSidebar={props.onToggleSidebar}
          instanceId={props.instanceId}
          onPathSubmit={props.onPathSubmit}
          pathEditRequestKey={props.pathEditRequestKey}
          onDragMove={props.onDragMove
            ? (items, targetPath) => props.onDragMove?.(
                items.map((item) => mapFileItemToAbsolutePath(item, props.homePath)),
                toAbsolutePath(targetPath),
              )
            : undefined}
          toolbarEndActions={props.toolbarEndActions}
          contextMenuCallbacks={displayContextMenuCallbacks()}
          overrideContextMenuItems={displayOverrideContextMenuItems()}
          resolveOverrideContextMenuItems={props.resolveOverrideContextMenuItems ? resolveDisplayOverrideContextMenuItems : undefined}
          class={props.class}
        />
      </FileBrowserProvider>
    </Show>
  );
}
