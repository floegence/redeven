import { createMemo, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { Maximize, Minus, X } from '@floegence/floe-webapp-core/icons';
import type {
  WorkbenchWidgetDefinition,
  WorkbenchWidgetItem,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { startWorkbenchHotInteraction } from './workbenchHotInteraction';
import {
  FLOE_DIALOG_SURFACE_HOST_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ID_ATTR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
  WORKBENCH_WIDGET_SHELL_ATTR,
  resolveRedevenWorkbenchWidgetEventOwnership,
} from './workbenchInputRouting';

interface LocalDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorldX: number;
  startWorldY: number;
  worldX: number;
  worldY: number;
  moved: boolean;
  scale: number;
  stopInteraction: () => void;
}

interface LocalResizeState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
  width: number;
  height: number;
  scale: number;
  stopInteraction: () => void;
}

/** Minimum widget footprint in world-space pixels. */
const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const WIDGET_HEADER_ACTION_SELECTOR = '[data-redeven-workbench-widget-header-action="true"]';

export interface RedevenWorkbenchWidgetProps {
  definition: WorkbenchWidgetDefinition;
  widgetId: string;
  widgetTitle: string;
  widgetType: WorkbenchWidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  renderLayer: number;
  itemSnapshot: () => WorkbenchWidgetItem;
  selected: boolean;
  optimisticFront: boolean;
  topRenderLayer: number;
  viewportScale: number;
  locked: boolean;
  filtered: boolean;
  onSelect: (widgetId: string) => void;
  onContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onFitWidget: () => void;
  onOverviewWidget: () => void;
  onRequestDelete: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
}

export function RedevenWorkbenchWidget(props: RedevenWorkbenchWidgetProps) {
  const [dragState, setDragState] = createSignal<LocalDragState | null>(null);
  const [resizeState, setResizeState] = createSignal<LocalResizeState | null>(null);
  let dragAbortController: AbortController | undefined;
  let resizeAbortController: AbortController | undefined;
  let widgetRootEl: HTMLElement | undefined;

  const startTrackedLayoutInteraction = (kind: 'drag' | 'resize', cursor: string) => {
    const stopHotInteraction = startWorkbenchHotInteraction({ kind, cursor });
    let stopped = false;
    props.onLayoutInteractionStart?.();
    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      stopHotInteraction();
      props.onLayoutInteractionEnd?.();
    };
  };

  onCleanup(() => {
    dragAbortController?.abort();
    dragAbortController = undefined;
    resizeAbortController?.abort();
    resizeAbortController = undefined;
    untrack(dragState)?.stopInteraction();
    untrack(resizeState)?.stopInteraction();
  });

  const isDragging = () => dragState() !== null;
  const isResizing = () => resizeState() !== null;
  const resolveEventOwnership = (target: EventTarget | null) =>
    resolveRedevenWorkbenchWidgetEventOwnership({
      target,
      widgetRoot: widgetRootEl ?? null,
    });
  const handlePointerDown: JSX.EventHandler<HTMLElement, PointerEvent> = (event) => {
    if (event.button !== 0) return;

    props.onSelect(props.widgetId);
    props.onCommitFront(props.widgetId);

    if (resolveEventOwnership(event.target) !== 'widget_shell') return;
    widgetRootEl?.focus({ preventScroll: true });
  };

  const livePosition = createMemo(() => {
    const current = dragState();
    if (!current) return { x: props.x, y: props.y };
    return { x: current.worldX, y: current.worldY };
  });

  const liveSize = createMemo(() => {
    const current = resizeState();
    if (!current) return { width: props.width, height: props.height };
    return { width: current.width, height: current.height };
  });
  const rootStyle = createMemo<JSX.CSSProperties>(() => {
    return {
      transform: `translate(${livePosition().x}px, ${livePosition().y}px)`,
      width: `${liveSize().width}px`,
      height: `${liveSize().height}px`,
      'z-index':
        isDragging() || isResizing() || props.optimisticFront
          ? `${props.topRenderLayer + 1}`
          : `${props.renderLayer}`,
    };
  });

  const finishDrag = (commitMove: boolean) => {
    const current = untrack(dragState);
    if (!current) return;

    const next = { x: current.worldX, y: current.worldY };
    const start = { x: current.startWorldX, y: current.startWorldY };
    const shouldCommitMove =
      commitMove &&
      (Math.abs(next.x - start.x) > 1 || Math.abs(next.y - start.y) > 1);

    // Commit position FIRST so the parent snapshot reflects the final value
    // before we release the local drag state. Otherwise livePosition would
    // snap back to stale props for a frame.
    props.onCommitFront(props.widgetId);
    if (shouldCommitMove) {
      props.onCommitMove(props.widgetId, next);
    }

    current.stopInteraction();
    setDragState(null);
    dragAbortController?.abort();
    dragAbortController = undefined;
  };

  const beginDrag: JSX.EventHandler<HTMLElement, PointerEvent> = (event) => {
    if (event.button !== 0 || props.locked) return;
    if (
      event.target instanceof Element &&
      event.target.closest(WIDGET_HEADER_ACTION_SELECTOR) !== null
    ) {
      return;
    }

    event.preventDefault();
    dragAbortController?.abort();
    props.onStartOptimisticFront(props.widgetId);

    const stopInteraction = startTrackedLayoutInteraction('drag', 'grabbing');
    const scale = Math.max(props.viewportScale, 0.001);

    setDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: props.x,
      startWorldY: props.y,
      worldX: props.x,
      worldY: props.y,
      moved: false,
      scale,
      stopInteraction,
    });

    const handleMove = (nextEvent: PointerEvent) => {
      setDragState((current) => {
        if (!current || current.pointerId !== nextEvent.pointerId) return current;
        const worldX =
          current.startWorldX + (nextEvent.clientX - current.startClientX) / current.scale;
        const worldY =
          current.startWorldY + (nextEvent.clientY - current.startClientY) / current.scale;
        return {
          ...current,
          worldX,
          worldY,
          moved:
            current.moved ||
            Math.abs(worldX - current.startWorldX) > 2 ||
            Math.abs(worldY - current.startWorldY) > 2,
        };
      });
    };

    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== event.pointerId) return;
      finishDrag(true);
    };

    const cancel = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== event.pointerId) return;
      finishDrag(false);
    };

    const controller = new AbortController();
    dragAbortController = controller;

    window.addEventListener('pointermove', handleMove, { signal: controller.signal });
    window.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
    window.addEventListener('pointercancel', cancel, { once: true, signal: controller.signal });
  };

  const finishResize = (commit: boolean) => {
    const current = untrack(resizeState);
    if (!current) return;

    const nextSize = { width: current.width, height: current.height };
    const changed =
      Math.abs(current.width - current.startWidth) > 1 ||
      Math.abs(current.height - current.startHeight) > 1;

    if (commit && changed) {
      props.onCommitResize(props.widgetId, nextSize);
    }

    current.stopInteraction();
    setResizeState(null);
    resizeAbortController?.abort();
    resizeAbortController = undefined;
  };

  const beginResize: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0 || props.locked) return;

    event.preventDefault();
    event.stopPropagation();
    resizeAbortController?.abort();
    props.onStartOptimisticFront(props.widgetId);

    const stopInteraction = startTrackedLayoutInteraction('resize', 'nwse-resize');
    const scale = Math.max(props.viewportScale, 0.001);

    setResizeState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: props.width,
      startHeight: props.height,
      width: props.width,
      height: props.height,
      scale,
      stopInteraction,
    });

    const handleMove = (nextEvent: PointerEvent) => {
      setResizeState((current) => {
        if (!current || current.pointerId !== nextEvent.pointerId) return current;
        const width = Math.max(
          MIN_WIDTH,
          current.startWidth + (nextEvent.clientX - current.startClientX) / current.scale
        );
        const height = Math.max(
          MIN_HEIGHT,
          current.startHeight + (nextEvent.clientY - current.startClientY) / current.scale
        );
        return { ...current, width, height };
      });
    };

    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== event.pointerId) return;
      finishResize(true);
    };

    const cancel = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== event.pointerId) return;
      finishResize(false);
    };

    const controller = new AbortController();
    resizeAbortController = controller;

    window.addEventListener('pointermove', handleMove, { signal: controller.signal });
    window.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
    window.addEventListener('pointercancel', cancel, { once: true, signal: controller.signal });
  };

  return (
    <article
      ref={widgetRootEl}
      class="workbench-widget"
      classList={{
        'is-selected': props.selected,
        'is-dragging': isDragging(),
        'is-resizing': isResizing(),
        'is-filtered-out': props.filtered,
      }}
      {...{ [FLOE_DIALOG_SURFACE_HOST_ATTR]: 'true' }}
      data-floe-workbench-widget-id={props.widgetId}
      {...{ [REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR]: 'true' }}
      {...{ [REDEVEN_WORKBENCH_WIDGET_ID_ATTR]: props.widgetId }}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onFocus={() => {
        props.onSelect(props.widgetId);
      }}
      onContextMenu={(event) => {
        if (resolveEventOwnership(event.target) !== 'widget_shell') return;
        event.preventDefault();
        event.stopPropagation();
        props.onSelect(props.widgetId);
        props.onCommitFront(props.widgetId);
        props.onContextMenu(event, props.itemSnapshot());
      }}
      style={rootStyle()}
    >
      <header
        class="workbench-widget__header"
        {...{ [WORKBENCH_WIDGET_SHELL_ATTR]: 'true' }}
        onPointerDown={beginDrag}
      >
        <div class="workbench-widget__title-area">
          {(() => {
            const Icon = props.definition.icon;
            return <Icon class="w-3.5 h-3.5" />;
          })()}
          <span class="workbench-widget__title">{props.widgetTitle}</span>
        </div>
        <div class="workbench-widget__actions">
          <button
            type="button"
            class="workbench-widget__focus"
            aria-label="Focus widget"
            title="Focus widget"
            data-floe-canvas-interactive="true"
            data-redeven-workbench-widget-header-action="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onFitWidget();
            }}
          >
            <Maximize class="w-3 h-3" />
          </button>
          <button
            type="button"
            class="workbench-widget__unfocus"
            aria-label="Show widget in overview"
            title="Show widget in overview"
            data-floe-canvas-interactive="true"
            data-redeven-workbench-widget-header-action="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onOverviewWidget();
            }}
          >
            <Minus class="w-3 h-3" />
          </button>
          <button
            type="button"
            class="workbench-widget__close"
            aria-label="Remove widget"
            data-floe-canvas-interactive="true"
            data-redeven-workbench-widget-header-action="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onRequestDelete(props.widgetId);
            }}
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      </header>
      <div class="workbench-widget__body" data-floe-canvas-interactive="true">
        {(() => {
          const Body = props.definition.body;
          return (
            <Body
              widgetId={props.widgetId}
              title={props.widgetTitle}
              type={props.widgetType}
            />
          );
        })()}
      </div>
      {props.locked ? null : (
        <div
          class="workbench-widget__resize"
          aria-label="Resize widget"
          data-floe-canvas-interactive="true"
          onPointerDown={beginResize}
        >
          <svg
            class="workbench-widget__resize-glyph"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="M12 0 L0 12" />
            <path d="M12 4 L4 12" />
            <path d="M12 8 L8 12" />
          </svg>
        </div>
      )}
    </article>
  );
}
