import { cn, useFileBrowserDrag, useResizeObserver, type FileBrowserDragContextValue, type DraggedItem } from '@floegence/floe-webapp-core';
import { FileItemIcon, useFileBrowser, type FileBrowserContextValue, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';

const GRID_CARD_HEIGHT = 112;
const GRID_GAP = 8;
const GRID_MIN_COLUMN_WIDTH = 180;
const GRID_MIN_COLUMNS = 2;
const GRID_MAX_COLUMNS = 6;
const GRID_OVERSCAN_ROWS = 2;
const DRAG_THRESHOLD_PX = 5;
const TOUCH_DRAG_CANCEL_PX = 10;
const LONG_PRESS_DELAY_MS = 500;
const FILE_BROWSER_TOUCH_TARGET_ATTRS = {
  'data-file-browser-touch-target': 'true',
} as const;

interface FilterMatchInfoLike {
  matchedIndices: number[];
}

interface VirtualRange {
  start: number;
  end: number;
}

interface UseFixedVirtualWindowOptions {
  count: Accessor<number>;
  itemSize: Accessor<number>;
  overscan?: number;
}

interface UseFixedVirtualWindowResult {
  scrollRef: (element: HTMLElement | null) => void;
  onScroll: () => void;
  range: Accessor<VirtualRange>;
  paddingTop: Accessor<number>;
  paddingBottom: Accessor<number>;
}

interface LongPressOptions {
  delayMs?: number;
  moveTolerancePx?: number;
  selectOnOpen?: boolean;
}

export interface RedevenFileGridViewProps {
  class?: string;
  instanceId?: string;
  enableDragDrop?: boolean;
}

interface RedevenFileGridItemProps {
  item: FileItem;
  instanceId: string;
  enableDragDrop: boolean;
  dragContext?: FileBrowserDragContextValue;
}

function useFixedVirtualWindow(options: UseFixedVirtualWindowOptions): UseFixedVirtualWindowResult {
  const overscan = options.overscan ?? 8;
  let scrollElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let frameId: number | null = null;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);

  const syncMetrics = () => {
    if (!scrollElement) return;
    setScrollTop(scrollElement.scrollTop);
    setViewportHeight(scrollElement.clientHeight);
  };

  const onScroll = () => {
    if (!scrollElement || frameId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      syncMetrics();
      return;
    }
    frameId = requestAnimationFrame(() => {
      frameId = null;
      syncMetrics();
    });
  };

  const range = createMemo<VirtualRange>(() => {
    const count = options.count();
    const itemSize = options.itemSize();
    const top = scrollTop();
    const height = viewportHeight();

    if (count <= 0 || itemSize <= 0) {
      return { start: 0, end: 0 };
    }

    const start = Math.max(0, Math.floor(top / itemSize) - overscan);
    const end = Math.min(count, Math.ceil((top + height) / itemSize) + overscan);
    return { start, end };
  });

  const paddingTop = createMemo(() => range().start * options.itemSize());
  const paddingBottom = createMemo(() => Math.max(0, options.count() - range().end) * options.itemSize());

  const scrollRef = (element: HTMLElement | null) => {
    if (scrollElement === element) return;

    resizeObserver?.disconnect();
    resizeObserver = null;
    scrollElement = element;

    if (!scrollElement || typeof ResizeObserver === 'undefined') return;

    resizeObserver = new ResizeObserver(() => {
      syncMetrics();
    });
    resizeObserver.observe(scrollElement);
    syncMetrics();
  };

  onCleanup(() => {
    resizeObserver?.disconnect();
    if (frameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  });

  return {
    scrollRef,
    onScroll,
    range,
    paddingTop,
    paddingBottom,
  };
}

function createLocalLongPressContextMenuHandlers(
  browser: FileBrowserContextValue,
  item: FileItem,
  options: LongPressOptions = {},
) {
  const delayMs = options.delayMs ?? LONG_PRESS_DELAY_MS;
  const moveTolerancePx = options.moveTolerancePx ?? TOUCH_DRAG_CANCEL_PX;
  const selectOnOpen = options.selectOnOpen ?? true;

  let timeoutId: number | null = null;
  let startPoint: { x: number; y: number } | null = null;
  let suppressClick = false;

  const clearPending = () => {
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    startPoint = null;
  };

  const markSuppressed = () => {
    suppressClick = true;
  };

  const openContextMenu = (x: number, y: number) => {
    if (!selectOnOpen) {
      browser.showContextMenu({ x, y, items: [item] });
      markSuppressed();
      return;
    }

    if (!browser.isSelected(item.id)) {
      browser.selectItem(item.id, false);
    }
    const selected = browser.getSelectedItemsList();
    browser.showContextMenu({ x, y, items: selected.length > 0 ? selected : [item] });
    markSuppressed();
  };

  const onPointerDown = (event: PointerEvent) => {
    suppressClick = false;
    if (event.pointerType === 'mouse' || typeof window === 'undefined') return;

    clearPending();
    startPoint = { x: event.clientX, y: event.clientY };
    const startX = event.clientX;
    const startY = event.clientY;

    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      openContextMenu(startX, startY);
    }, delayMs);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (timeoutId === null || !startPoint) return;
    const offsetX = event.clientX - startPoint.x;
    const offsetY = event.clientY - startPoint.y;
    if (Math.hypot(offsetX, offsetY) > moveTolerancePx) {
      clearPending();
      markSuppressed();
    }
  };

  const onPointerUp = () => {
    clearPending();
  };

  const onPointerCancel = () => {
    clearPending();
  };

  const consumeClickSuppression = (event: MouseEvent) => {
    if (!suppressClick) return false;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  onCleanup(() => {
    clearPending();
  });

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    consumeClickSuppression,
  };
}

function HighlightedFileName(props: { name: string; match: FilterMatchInfoLike | null }) {
  const segments = createMemo(() => {
    if (!props.match || props.match.matchedIndices.length === 0) {
      return [{ text: props.name, highlight: false }];
    }

    const result: Array<{ text: string; highlight: boolean }> = [];
    const matchedIndices = new Set(props.match.matchedIndices);
    let currentText = '';
    let currentHighlight = false;

    for (let index = 0; index < props.name.length; index += 1) {
      const nextHighlight = matchedIndices.has(index);
      if (index === 0) {
        currentHighlight = nextHighlight;
        currentText = props.name[index] ?? '';
        continue;
      }

      if (nextHighlight === currentHighlight) {
        currentText += props.name[index] ?? '';
        continue;
      }

      result.push({ text: currentText, highlight: currentHighlight });
      currentText = props.name[index] ?? '';
      currentHighlight = nextHighlight;
    }

    if (currentText) {
      result.push({ text: currentText, highlight: currentHighlight });
    }

    return result;
  });

  return (
    <For each={segments()}>
      {(segment) => (
        <Show when={segment.highlight} fallback={segment.text}>
          <mark class="rounded-sm bg-warning/40 text-inherit">{segment.text}</mark>
        </Show>
      )}
    </For>
  );
}

function RedevenFileGridItem(props: RedevenFileGridItemProps) {
  const browser = useFileBrowser();
  const isSelected = () => browser.isSelected(props.item.id);
  const filterMatch = () => browser.getFilterMatchForId(props.item.id) as FilterMatchInfoLike | null;
  const item = untrack(() => props.item);
  const longPress = createLocalLongPressContextMenuHandlers(browser, item);

  let activePointerType: string | undefined;
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let isDragging = false;
  let longPressTimer: number | null = null;

  const isTouchLike = () => activePointerType === 'touch' || activePointerType === 'pen';
  const isFolder = () => props.item.type === 'folder';
  const canAcceptDrop = () => isFolder() && props.enableDragDrop && props.dragContext;
  const dragState = () => props.dragContext?.dragState();
  const isAnyDragActive = () => dragState()?.isDragging ?? false;
  const isDropTarget = () => {
    if (!canAcceptDrop() || !props.dragContext) return false;
    const state = props.dragContext.dragState();
    if (!state.isDragging) return false;
    return props.dragContext.canDropOn(state.draggedItems, props.item.path, props.item, props.instanceId);
  };
  const isDraggedItem = () => {
    const state = dragState();
    return state?.isDragging
      ? state.draggedItems.some((entry) => entry.item.id === props.item.id)
      : false;
  };

  const clearLongPressTimer = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const removeDocumentListeners = () => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('pointermove', handleDocumentPointerMove, true);
    document.removeEventListener('pointerup', handleDocumentPointerUp, true);
    document.removeEventListener('pointercancel', handleDocumentPointerCancel, true);
  };

  const endPointerTracking = (commitDrag: boolean) => {
    clearLongPressTimer();
    removeDocumentListeners();
    if (isDragging && props.dragContext) {
      props.dragContext.endDrag(commitDrag);
    }
    pointerId = null;
    isDragging = false;
  };

  onCleanup(() => {
    endPointerTracking(false);
  });

  const startDrag = (x: number, y: number) => {
    if (!props.enableDragDrop || !props.dragContext || isDragging) return;

    isDragging = true;
    if (!isSelected()) {
      browser.selectItem(props.item.id, false);
    }

    const selected = browser.getSelectedItemsList();
    const draggedItems: DraggedItem[] = (selected.length > 0 && isSelected() ? selected : [props.item]).map((entry) => ({
      item: entry,
      sourceInstanceId: props.instanceId,
      sourcePath: browser.currentPath(),
    }));

    if (isTouchLike() && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch {
        // Ignore vibration failures on unsupported platforms.
      }
    }

    props.dragContext.startDrag(draggedItems, x, y);
  };

  const handleDocumentPointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;

    const deltaX = event.clientX - originX;
    const deltaY = event.clientY - originY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (isTouchLike() && !isDragging && distance > TOUCH_DRAG_CANCEL_PX) {
      endPointerTracking(false);
      return;
    }

    if (!isTouchLike() && !isDragging && distance > DRAG_THRESHOLD_PX) {
      startDrag(event.clientX, event.clientY);
    }

    if (isDragging && props.dragContext) {
      props.dragContext.updateDrag(event.clientX, event.clientY);
    }
  };

  const handleDocumentPointerUp = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    longPress.onPointerUp();
    endPointerTracking(true);
  };

  const handleDocumentPointerCancel = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    longPress.onPointerCancel();
    endPointerTracking(false);
  };

  const addDocumentListeners = () => {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointermove', handleDocumentPointerMove, true);
    document.addEventListener('pointerup', handleDocumentPointerUp, true);
    document.addEventListener('pointercancel', handleDocumentPointerCancel, true);
  };

  const handlePointerDown = (event: PointerEvent) => {
    activePointerType = event.pointerType;
    longPress.onPointerDown(event);

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (!props.enableDragDrop || !props.dragContext) {
      return;
    }

    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    isDragging = false;
    addDocumentListeners();

    if (isTouchLike()) {
      clearLongPressTimer();
      longPressTimer = window.setTimeout(() => {
        if (pointerId === null || isDragging) return;
        startDrag(originX, originY);
      }, LONG_PRESS_DELAY_MS);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    activePointerType = event.pointerType;
    longPress.onPointerMove(event);
  };

  const handlePointerEnter = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (!canAcceptDrop() || !props.dragContext) return;
    const state = props.dragContext.dragState();
    if (!state.isDragging) return;

    const isValid = props.dragContext.canDropOn(state.draggedItems, props.item.path, props.item, props.instanceId);
    props.dragContext.setDropTarget(
      {
        instanceId: props.instanceId,
        targetPath: props.item.path,
        targetItem: props.item,
      },
      isValid,
      event.currentTarget.getBoundingClientRect(),
    );
  };

  const handlePointerLeave = () => {
    if (!props.dragContext) return;
    const state = props.dragContext.dragState();
    if (!state.isDragging) return;
    if (state.dropTarget?.targetPath === props.item.path) {
      props.dragContext.setDropTarget(null, false);
    }
  };

  const handleClick = (event: MouseEvent) => {
    if (isDragging) {
      isDragging = false;
      return;
    }

    if (longPress.consumeClickSuppression(event)) {
      return;
    }

    if (isTouchLike()) {
      browser.openItem(props.item);
      return;
    }

    browser.selectItem(props.item.id, event.metaKey || event.ctrlKey);
  };

  const handleDoubleClick = () => {
    if (isTouchLike()) return;
    browser.openItem(props.item);
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (isTouchLike()) return;

    if (!isSelected()) {
      browser.selectItem(props.item.id, false);
    }
    const selected = browser.getSelectedItemsList();
    browser.showContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: selected.length > 0 ? selected : [props.item],
    });
  };

  return (
    <button
      {...FILE_BROWSER_TOUCH_TARGET_ATTRS}
      type="button"
      title={props.item.name}
      aria-label={props.item.name}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      class={cn(
        'group relative flex h-28 cursor-pointer flex-col items-center gap-2 rounded-lg p-3',
        'transition-all duration-150 ease-out',
        'hover:scale-[1.02] hover:bg-accent/50',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring',
        'active:scale-[0.98]',
        isSelected() && 'bg-accent ring-2 ring-primary/50',
        isDraggedItem() && 'scale-90 opacity-40',
        canAcceptDrop() && isAnyDragActive() && isDropTarget() && ['scale-105 bg-primary/15 ring-2 ring-primary/60 shadow-lg shadow-primary/15'],
        canAcceptDrop() && isAnyDragActive() && !isDropTarget() && dragState()?.dropTarget?.targetPath === props.item.path && ['bg-destructive/10 ring-2 ring-dashed ring-destructive/50'],
      )}
    >
      <Show when={isSelected()}>
        <div class="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-2.5 w-2.5 text-primary-foreground"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </Show>

      <div
        class={cn(
          'flex h-12 w-12 items-center justify-center rounded-lg',
          'transition-transform duration-200 group-hover:scale-110',
          props.item.type === 'folder' ? 'bg-warning/10' : 'bg-muted/50',
        )}
      >
        <FileItemIcon item={props.item} class="h-8 w-8" />
      </div>

      <span
        data-file-grid-name="true"
        class={cn(
          'block w-full min-w-0 truncate px-1 text-center text-xs',
          'transition-colors duration-150',
          isSelected() && 'font-medium',
        )}
      >
        <HighlightedFileName name={props.item.name} match={filterMatch()} />
      </span>

      <div
        class={cn(
          'pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-100',
        )}
        style={{
          background: props.item.type === 'folder'
            ? 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--warning) 8%, transparent), transparent 70%)'
            : 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--primary) 5%, transparent), transparent 70%)',
        }}
      />
    </button>
  );
}

export function RedevenFileGridView(props: RedevenFileGridViewProps) {
  const browser = useFileBrowser();
  const dragContext = useFileBrowserDrag();
  const dragEnabled = () => Boolean((props.enableDragDrop ?? true) && dragContext);
  const instanceId = () => props.instanceId ?? 'default';
  const itemSize = () => GRID_CARD_HEIGHT + GRID_GAP;

  let measureElement: HTMLDivElement | null = null;
  let scrollElement: HTMLDivElement | null = null;
  let previousColumns = GRID_MIN_COLUMNS;

  const size = useResizeObserver(() => measureElement);
  const columns = createMemo(() => {
    const width = size()?.width ?? 0;
    if (width <= 0) return GRID_MIN_COLUMNS;
    const next = Math.floor((width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP));
    return Math.max(GRID_MIN_COLUMNS, Math.min(GRID_MAX_COLUMNS, next));
  });
  const virtualWindow = useFixedVirtualWindow({
    count: () => Math.ceil(browser.currentFiles().length / Math.max(1, columns())),
    itemSize,
    overscan: GRID_OVERSCAN_ROWS,
  });

  const startIndex = () => virtualWindow.range().start * columns();
  const endIndex = () => Math.min(browser.currentFiles().length, virtualWindow.range().end * columns());
  const visibleFiles = createMemo(() => browser.currentFiles().slice(startIndex(), endIndex()));

  createEffect(() => {
    const nextColumns = columns();
    if (!scrollElement) {
      previousColumns = nextColumns;
      return;
    }
    if (nextColumns === previousColumns) return;

    const currentRow = Math.floor(scrollElement.scrollTop / Math.max(1, itemSize()));
    const currentIndex = currentRow * Math.max(1, previousColumns);
    const nextRow = Math.floor(currentIndex / Math.max(1, nextColumns));
    scrollElement.scrollTop = nextRow * itemSize();
    virtualWindow.onScroll();
    previousColumns = nextColumns;
  });

  return (
    <div
      ref={(element) => {
        scrollElement = element;
        virtualWindow.scrollRef(element);
        browser.setScrollContainer(element);
      }}
      onScroll={virtualWindow.onScroll}
      class={cn('h-full min-h-0 overflow-auto', props.class)}
    >
      <div class="p-3">
        <div
          ref={(element) => {
            measureElement = element;
          }}
          class="h-0 w-full"
          aria-hidden="true"
        />

        <Show
          when={browser.currentFiles().length > 0}
          fallback={(
            <div class="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Show
                when={browser.filterQueryApplied().trim()}
                fallback={<span>This folder is empty</span>}
              >
                <>
                  <span>
                    No files matching "{browser.filterQueryApplied()}"
                  </span>
                  <button
                    type="button"
                    class="rounded bg-muted px-2 py-1 transition-colors hover:bg-muted/80"
                    onClick={() => browser.setFilterQuery('')}
                  >
                    Clear Filter
                  </button>
                </>
              </Show>
            </div>
          )}
        >
          <div
            class="grid gap-2"
            style={{
              'grid-template-columns': `repeat(${columns()}, minmax(0, 1fr))`,
              'padding-top': `${virtualWindow.paddingTop()}px`,
              'padding-bottom': `${virtualWindow.paddingBottom()}px`,
            }}
          >
            <For each={visibleFiles()}>
              {(item) => (
                <RedevenFileGridItem
                  item={item}
                  instanceId={instanceId()}
                  enableDragDrop={dragEnabled()}
                  dragContext={dragContext}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
