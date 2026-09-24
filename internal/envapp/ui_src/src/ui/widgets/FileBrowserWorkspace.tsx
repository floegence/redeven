import './file-workspace-header.css';
import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, useFileBrowserDrag, useResizeObserver } from '@floegence/floe-webapp-core';
import { Files as FilesIcon, Search, ArrowUp } from '@floegence/floe-webapp-core/icons';
import {
  FileBrowserDragPreview,
  FileBrowserProvider,
  FileBrowserStatusBar,
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
import { Button, SegmentedControl, formatPickerPath, parsePickerPath, type SurfaceFloatingBoundary } from '@floegence/floe-webapp-core/ui';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { FileBrowserPathControl, type FileBrowserPathControlMode } from './FileBrowserPathControl';
import { FileBrowserSidebarTree } from './FileBrowserSidebarTree';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { useFileBrowserTypeToFilter } from './fileBrowserTypeToFilter';
import { resolveFileBrowserToolbarLayout } from './fileBrowserPathLayout';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS } from '../workbench/surface/workbenchActionSurface';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import type { NormalizedFilesystemRoot } from '../utils/filesystemRoots';
import { matchFilesystemRoot } from '../utils/filesystemRoots';
import { useI18n } from '../i18n';

const FILE_WORKSPACE_TOOLBAR_FIELD_CLASS =
  cn('h-8 min-w-0 rounded-md border px-2.5', redevenSurfaceRoleClass('controlMuted'));
const FILE_WORKSPACE_TOOLBAR_SEGMENTED_CLASS =
  cn('h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:py-0', redevenSurfaceRoleClass('segmented'));
const FILE_WORKSPACE_TOOLBAR_PATH_CLASS = 'h-8 min-w-0 rounded-md border border-transparent px-2.5 flex items-center';
const FILE_WORKSPACE_TOOLBAR_FILTER_CLASS =
  `${FILE_WORKSPACE_TOOLBAR_FIELD_CLASS} flex items-center gap-1.5 text-[length:var(--floe-type-control)] text-muted-foreground`;

export type FileBrowserPathSubmitResult =
  | { status: 'ready' | 'refreshed'; committedPath: string }
  | { status: 'error'; message: string };

export interface FileBrowserWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  onPreviewGitMode?: () => void;
  gitHistoryDisabled?: boolean;
  gitHistoryDisabledReason?: string;
  captureTypingFromPage?: boolean;
  files: FileItem[];
  currentPath: string;
  pendingNavigationPath?: string;
  initialPath: string;
  homePath?: string;
  roots?: NormalizedFilesystemRoot[];
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
  onRootSelect?: (path: string) => void;
  onRootWritePermissionChange?: (root: NormalizedFilesystemRoot, write: boolean) => Promise<void> | void;
  onPathChange?: (path: string, source: 'user' | 'programmatic') => void;
  onPathSubmit?: (path: string) => Promise<FileBrowserPathSubmitResult>;
  onOpen?: (item: FileItem) => void;
  onDragMove?: (items: FileItem[], targetPath: string) => void;
  revealRequest?: FileBrowserRevealRequest | null;
  onRevealRequestConsumed?: (requestId: string) => void;
  pathEditRequestKey?: number;
  toolbarEndActions?: JSX.Element;
  contentNotice?: JSX.Element;
  contentUnavailable?: boolean;
  /** No directory response exists yet; an empty array is not an empty result. */
  initializing?: boolean;
  /** Client-coordinate limit supplied by shell overlays, when present. */
  contextMenuBottomLimit?: number;
  contextMenuCallbacks?: ContextMenuCallbacks;
  overrideContextMenuItems?: ContextMenuItem[];
  resolveOverrideContextMenuItems?: (event: ContextMenuEvent | null) => ContextMenuItem[] | undefined;
  class?: string;
}

interface FileWorkspaceHeaderProps {
  initializing?: boolean;
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
  const i18n = useI18n();
  let toolbarLayoutRef: HTMLDivElement | undefined;
  const toolbarSize = useResizeObserver(() => toolbarLayoutRef, { preserveWhenHidden: true });
  const canNavigateUp = () => {
    const path = browser.currentPath();
    return path !== '/' && path !== '';
  };
  const toolbarLayout = createMemo(() => resolveFileBrowserToolbarLayout(toolbarSize()?.width ?? 0));
  const hasHeaderStatus = () => (
    Boolean(browser.filterQueryApplied().trim())
    || Boolean(props.pathStatusText?.trim())
  );

  return (
    <div class={cn('file-workspace-header shrink-0 border-b px-2.5 py-1.5', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}>
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
              variant="ghost"
              icon={FilesIcon}
              {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
              aria-label={i18n.t('files.sidebarToggle')}
              onClick={props.onToggleSidebar}
            >
              {i18n.t('files.sidebar')}
            </Button>
          </Show>

          <Button size="sm" variant="ghost" icon={ArrowUp} {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS} onClick={browser.navigateUp} disabled={props.initializing || !canNavigateUp()}>
            {i18n.t('files.up')}
          </Button>
        </div>

        <div data-floe-reload-omit data-floe-surface={props.pathControlMode === 'edit' ? 'inset' : undefined} data-floe-input-surface={props.pathControlMode === 'edit' ? '' : undefined} aria-invalid={Boolean(props.pathError) || undefined} class={cn(FILE_WORKSPACE_TOOLBAR_PATH_CLASS, props.pathControlMode === 'edit' && redevenSurfaceRoleClass('controlMuted'))}>
          <Show when={!props.initializing}>
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
          </Show>
        </div>

        <div
          class={cn(
            'flex min-w-0 items-center gap-1.5',
            toolbarLayout() === 'inline'
              ? 'justify-self-end'
              : 'col-span-2'
          )}
        >
          <label
            data-floe-input-surface
            data-floe-surface="inset"
            class={cn(
              FILE_WORKSPACE_TOOLBAR_FILTER_CLASS,
              toolbarLayout() === 'inline'
                ? 'w-[15rem] min-w-[200px]'
                : 'min-w-[128px] flex-1'
            )}
          >
            <Search class="size-3.5 shrink-0" />
            <input
              ref={props.filterInputRef}
              type="text"
              value={browser.filterQuery()}
              onInput={(event) => browser.setFilterQuery(event.currentTarget.value)}
              placeholder={i18n.t('files.filterPlaceholder')}
              aria-label={i18n.t('files.filterPlaceholder')}
              class="h-full min-w-0 flex-1 border-0 bg-transparent text-[length:var(--floe-type-control)] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>

          <div class="flex shrink-0 items-center gap-1.5">
            <div class="file-workspace-view-segmented"><SegmentedControl
              size="sm"
              class={FILE_WORKSPACE_TOOLBAR_SEGMENTED_CLASS}
              value={browser.viewMode()}
              {...REDEVEN_WORKBENCH_ACTION_SURFACE_PROPS}
              onChange={(value) => browser.setViewMode(value === 'grid' ? 'grid' : 'list')}
              options={[
                { value: 'list', label: i18n.t('files.viewList') },
                { value: 'grid', label: i18n.t('files.viewGrid') },
              ]}
            /></div>
            <Button class="file-workspace-view-toggle" size="sm" variant="ghost" aria-label={i18n.t(browser.viewMode() === 'list' ? 'files.viewGrid' : 'files.viewList')}
              title={i18n.t(browser.viewMode() === 'list' ? 'files.viewGrid' : 'files.viewList')}
              onClick={() => browser.setViewMode(browser.viewMode() === 'list' ? 'grid' : 'list')}>
              <FilesIcon class="h-4 w-4" />
            </Button>

            <Show when={props.toolbarEndActions}>
              <div class="flex items-center gap-1">{props.toolbarEndActions}</div>
            </Show>
          </div>
        </div>
      </div>

      <Show when={hasHeaderStatus()}>
        <div data-testid="file-browser-header-status" class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Show when={browser.filterQueryApplied().trim()}>
            <span>{i18n.t('files.filterActive')}</span>
          </Show>
          <Show when={props.pathStatusText?.trim()}>
            <Show when={Boolean(browser.filterQueryApplied().trim())}>
              <span aria-hidden="true">·</span>
            </Show>
            <span class={props.pathStatusTone === 'error' ? 'text-destructive' : undefined}>{props.pathStatusText}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function FileWorkspaceStatusBar(props: { initializing?: boolean }) {
  const i18n = useI18n();

  return (
    <div data-floe-reload-omit class="shrink-0" classList={{ invisible: props.initializing }} aria-hidden={props.initializing || undefined}>
      <FileBrowserStatusBar
        class={cn('px-2.5', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}
        pathClass="max-w-full sm:max-w-[45%]"
        formatItemCount={(count) => i18n.tn('files.itemCount', count)}
        filteredLabel={i18n.t('files.filteredView')}
        formatSelectedCount={(count) => i18n.tn('files.selectedCount', count)}
      />
    </div>
  );
}

function FileBrowserWorkspaceInner(props: Omit<FileBrowserWorkspaceProps, 'files' | 'initialPath' | 'persistenceKey' | 'resetKey'>) {
  const browser = useFileBrowser();
  const drag = useFileBrowserDrag();
  const i18n = useI18n();
  const dragEnabled = () => Boolean(drag && props.onDragMove && !props.contentUnavailable);
  const resolvedOverrideContextMenuItems = createMemo(() => {
    if (!props.resolveOverrideContextMenuItems) {
      return props.overrideContextMenuItems;
    }
    return props.resolveOverrideContextMenuItems(browser.contextMenu() ?? null);
  });
  const [menuBoundaryElement, setMenuBoundaryElement] = createSignal<HTMLDivElement>();
  const [menuBoundaryRect, setMenuBoundaryRect] = createSignal<DOMRectReadOnly | null>(null, {
    equals: (left, right) => left?.left === right?.left && left?.top === right?.top && left?.right === right?.right && left?.bottom === right?.bottom,
  });
  onMount(() => {
    const element = menuBoundaryElement();
    if (!element) return;
    const measure = () => setMenuBoundaryRect(element.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Refresh client geometry before any pointer or keyboard menu trigger.
    // Position-only changes do not notify ResizeObserver.
    const triggers = ['pointerdown', 'contextmenu', 'keydown'] as const;
    triggers.forEach((event) => element.addEventListener(event, measure, true));
    onCleanup(() => {
      observer.disconnect();
      triggers.forEach((event) => element.removeEventListener(event, measure, true));
    });
  });
  const menuBoundary = createMemo<SurfaceFloatingBoundary>(() => {
    const element = menuBoundaryElement();
    const bottomLimit = props.contextMenuBottomLimit;
    if (bottomLimit === undefined) return element ?? null;
    const rect = menuBoundaryRect();
    if (!element?.isConnected || !rect) return null;
    const bottom = Math.max(rect.top, Math.min(rect.bottom, bottomLimit));
    return { left: rect.left, top: rect.top, right: rect.right, bottom, width: rect.width, height: bottom - rect.top };
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
  const formattedCurrentPath = createMemo(() => formatPickerPath(props.currentPath, props.homePath));
  const currentRoot = createMemo(() => matchFilesystemRoot(props.currentPath, props.roots ?? []));
  const pathStatus = createMemo(() => {
    if (pathControlMode() !== 'edit') return null;
    if (pathError().trim()) {
      return { tone: 'error' as const, text: pathError().trim() };
    }
    if (pathSubmitting()) {
      return { tone: 'muted' as const, text: i18n.t('files.openingPath') };
    }
    return { tone: 'muted' as const, text: i18n.t('files.pathEditHint') };
  });

  const focusPathInput = () => {
    requestAnimationFrame(() => {
      pathInputEl?.focus();
      pathInputEl?.select();
    });
  };

  const openPathEditor = () => {
    if (props.initializing || pathSubmitting()) return;
    setPathDraft(formattedCurrentPath());
    setPathError('');
    setPathControlMode('edit');
    focusPathInput();
  };

  const closePathEditor = () => {
    if (props.initializing || pathSubmitting()) return;
    setPathControlMode('read');
    setPathError('');
    setPathDraft(formattedCurrentPath());
  };

  const submitPathEditor = async () => {
    if (props.initializing || pathSubmitting()) return;

    const rawPath = pathDraft().trim();
    const absolutePath = parsePickerPath(rawPath, props.homePath);
    if (!absolutePath) {
      const homeUnavailable = (rawPath === '~' || rawPath.startsWith('~/')) && !parsePickerPath(props.homePath ?? '');
      setPathError(i18n.t(homeUnavailable ? 'files.pathHomeUnavailable' : 'files.pathInputInvalid'));
      focusPathInput();
      return;
    }

    if (!props.onPathSubmit) {
      browser.setCurrentPath(absolutePath);
      setPathControlMode('read');
      setPathError('');
      return;
    }

    setPathSubmitting(true);
    setPathError('');
    try {
      const result = await props.onPathSubmit(absolutePath);
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
    enabled: () => props.mode === 'files' && !props.initializing,
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
    if (props.initializing || props.contentUnavailable) return;
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
      rootRef={setMenuBoundaryElement}
      title={i18n.t('files.title')}
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
          onPreviewGitMode={props.onPreviewGitMode}
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          class="w-full"
        />
      )}
      sidebarBody={(
        <div class="flex h-full min-h-0 flex-col gap-1.5">
          <div class="flex min-h-[18px] items-center justify-between px-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
            <span>{i18n.t('files.folderTree')}</span>
            <span data-floe-reload-omit class="flex items-center gap-1">
              <Show when={!props.initializing}>
                <span>{currentRoot()?.label ?? i18n.t('files.compactDepth')}</span>
              </Show>
              <Show when={!props.initializing && currentRoot()}>
                {(root) => (
                  <span
                    class="rounded-full border border-border/40 bg-background/80 px-1 py-0 text-[8px] font-semibold leading-4 text-muted-foreground"
                    title={i18n.t('files.rootAccessTitle', { label: root().label, mode: root().permissions.write ? i18n.t('files.readWriteAccess') : i18n.t('files.readOnlyAccess') })}
                  >
                    {root().permissions.write ? i18n.t('files.readWriteBadge') : i18n.t('files.readOnlyBadge')}
                  </span>
                )}
              </Show>
            </span>
          </div>

          <div
            ref={(el) => {
              treeScrollEl = el;
            }}
            {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
            data-floe-reload-omit
            data-testid="file-tree-scroll-region"
            class="min-h-0 flex-1 overflow-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] [-webkit-overflow-scrolling:touch] [touch-action:pan-y_pinch-zoom]"
          >
            <Show when={!props.initializing}>
              <FileBrowserSidebarTree
                instanceId={props.instanceId}
                enableDragDrop={dragEnabled()}
                sidebarOpen={props.open}
                scrollContainer={() => treeScrollEl}
                pendingNavigationPath={props.pendingNavigationPath}
                roots={props.roots}
                currentPath={props.currentPath}
                onRootSelect={props.onRootSelect}
                onRootWritePermissionChange={props.onRootWritePermissionChange}
                class="min-h-full"
              />
            </Show>
          </div>
        </div>
      )}
      content={(
        <div
          ref={(el) => {
            workspaceRootEl = el;
          }}
          tabindex={-1}
          class={cn('flex h-full min-h-0 flex-col focus:outline-none', redevenSurfaceRoleClass('main'))}
        >
          <FileWorkspaceHeader
            initializing={props.initializing}
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
            data-floe-reload-omit
            data-testid="file-browser-content-scroll-region"
            data-file-browser-initial-loading={props.initializing || undefined}
            role={props.initializing ? 'status' : undefined}
            aria-busy={props.initializing || undefined}
            aria-label={props.initializing ? i18n.t('files.loadingFiles') : undefined}
            class={cn('flex min-h-0 flex-1 flex-col overflow-auto', redevenSurfaceRoleClass('main'))}
            onContextMenu={handleWorkspaceBackgroundContextMenu}
          >
            {props.contentNotice}
            <Show when={!props.initializing && !props.contentUnavailable}>
              <Show when={browser.viewMode() === 'list'} fallback={<FileGridView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full" />}>
                <FileListView instanceId={props.instanceId} enableDragDrop={dragEnabled()} class="h-full redeven-file-list-compact" />
              </Show>
            </Show>
          </div>
          <Show when={!props.contentUnavailable}><FileWorkspaceStatusBar initializing={props.initializing} /></Show>
          <FileContextMenu
            boundary={menuBoundary()}
            backLabel={i18n.t('files.contextMenuBack')}
            scrollViewportProps={{ ...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS, 'aria-label': i18n.t('files.title') }}
            callbacks={props.contextMenuCallbacks}
            overrideItems={resolvedOverrideContextMenuItems()}
          />
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
  const i18n = useI18n();
  return (
    <Show when={props.resetKey + 1} keyed>
      <FileBrowserProvider
        files={props.files}
        path={props.currentPath}
        initialPath={props.initialPath}
        initialViewMode="grid"
        persistenceKey={props.persistenceKey}
        homeLabel={i18n.t('files.rootLabel')}
        onNavigate={props.onNavigate}
        onPathChange={props.onPathChange}
        onOpen={props.onOpen}
        revealRequest={props.revealRequest}
        onRevealRequestConsumed={props.onRevealRequestConsumed}
      >
        <FileBrowserWorkspaceInner
          mode={props.mode}
          onModeChange={props.onModeChange}
          onPreviewGitMode={props.onPreviewGitMode}
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          captureTypingFromPage={props.captureTypingFromPage}
          currentPath={props.currentPath}
          pendingNavigationPath={props.pendingNavigationPath}
          homePath={props.homePath}
          roots={props.roots}
          width={props.width}
          open={props.open}
          resizable={props.resizable}
          onResize={props.onResize}
          onClose={props.onClose}
          showMobileSidebarButton={props.showMobileSidebarButton}
          onToggleSidebar={props.onToggleSidebar}
          onRootSelect={props.onRootSelect}
          onRootWritePermissionChange={props.onRootWritePermissionChange}
          instanceId={props.instanceId}
          onPathSubmit={props.onPathSubmit}
          pathEditRequestKey={props.pathEditRequestKey}
          onDragMove={props.onDragMove}
          toolbarEndActions={props.toolbarEndActions}
          contentNotice={props.contentNotice}
          contentUnavailable={props.contentUnavailable}
          initializing={props.initializing}
          contextMenuBottomLimit={props.contextMenuBottomLimit}
          contextMenuCallbacks={props.contextMenuCallbacks}
          overrideContextMenuItems={props.overrideContextMenuItems}
          resolveOverrideContextMenuItems={props.resolveOverrideContextMenuItems}
          class={props.class}
        />
      </FileBrowserProvider>
    </Show>
  );
}
