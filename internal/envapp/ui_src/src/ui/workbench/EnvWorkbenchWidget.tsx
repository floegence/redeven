import { createMemo, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { startHotInteraction } from '@floegence/floe-webapp-core';
import { GripVertical, X } from '@floegence/floe-webapp-core/icons';
import type { EnvWorkbenchWidgetDefinition, EnvWorkbenchWidgetItem } from './types';

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

const MIN_WIDTH = 260;
const MIN_HEIGHT = 180;

export interface EnvWorkbenchWidgetProps {
  definition: EnvWorkbenchWidgetDefinition;
  item: EnvWorkbenchWidgetItem;
  selected: boolean;
  optimisticFront: boolean;
  topZIndex: number;
  viewportScale: number;
  locked: boolean;
  filtered: boolean;
  onSelect: (widgetId: string) => void;
  onContextMenu: (event: MouseEvent, item: EnvWorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
}

export function EnvWorkbenchWidget(props: EnvWorkbenchWidgetProps) {
  const [dragState, setDragState] = createSignal<LocalDragState | null>(null);
  const [resizeState, setResizeState] = createSignal<LocalResizeState | null>(null);
  let dragAbortController: AbortController | undefined;
  let resizeAbortController: AbortController | undefined;

  onCleanup(() => {
    dragAbortController?.abort();
    resizeAbortController?.abort();
    untrack(dragState)?.stopInteraction();
    untrack(resizeState)?.stopInteraction();
  });

  const isDragging = () => dragState() !== null;
  const isResizing = () => resizeState() !== null;

  const livePosition = createMemo(() => {
    const current = dragState();
    if (!current) {
      return { x: props.item.x, y: props.item.y };
    }
    return { x: current.worldX, y: current.worldY };
  });

  const liveSize = createMemo(() => {
    const current = resizeState();
    if (!current) {
      return { width: props.item.width, height: props.item.height };
    }
    return { width: current.width, height: current.height };
  });

  const finishDrag = (commitMove: boolean) => {
    const current = untrack(dragState);
    if (!current) {
      return;
    }

    const next = { x: current.worldX, y: current.worldY };
    const start = { x: current.startWorldX, y: current.startWorldY };
    const shouldCommitMove = commitMove
      && (Math.abs(next.x - start.x) > 1 || Math.abs(next.y - start.y) > 1);

    props.onCommitFront(props.item.id);
    if (shouldCommitMove) {
      props.onCommitMove(props.item.id, next);
    }

    current.stopInteraction();
    setDragState(null);
    dragAbortController?.abort();
    dragAbortController = undefined;
  };

  const beginDrag: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (event) => {
    if (event.button !== 0 || props.locked) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragAbortController?.abort();
    props.onStartOptimisticFront(props.item.id);

    const scale = Math.max(props.viewportScale, 0.001);
    const stopInteraction = startHotInteraction({ kind: 'drag', cursor: 'grabbing' });

    setDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: props.item.x,
      startWorldY: props.item.y,
      worldX: props.item.x,
      worldY: props.item.y,
      moved: false,
      scale,
      stopInteraction,
    });

    const handleMove = (nextEvent: PointerEvent) => {
      setDragState((current) => {
        if (!current || current.pointerId !== nextEvent.pointerId) {
          return current;
        }
        const worldX = current.startWorldX + (nextEvent.clientX - current.startClientX) / current.scale;
        const worldY = current.startWorldY + (nextEvent.clientY - current.startClientY) / current.scale;
        return {
          ...current,
          worldX,
          worldY,
          moved: current.moved
            || Math.abs(worldX - current.startWorldX) > 2
            || Math.abs(worldY - current.startWorldY) > 2,
        };
      });
    };

    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId === event.pointerId) {
        finishDrag(true);
      }
    };

    const cancel = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId === event.pointerId) {
        finishDrag(false);
      }
    };

    const controller = new AbortController();
    dragAbortController = controller;
    window.addEventListener('pointermove', handleMove, { signal: controller.signal });
    window.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
    window.addEventListener('pointercancel', cancel, { once: true, signal: controller.signal });
  };

  const finishResize = (commit: boolean) => {
    const current = untrack(resizeState);
    if (!current) {
      return;
    }

    const next = { width: current.width, height: current.height };
    const changed = Math.abs(current.width - current.startWidth) > 1 || Math.abs(current.height - current.startHeight) > 1;
    if (commit && changed) {
      props.onCommitResize(props.item.id, next);
    }

    current.stopInteraction();
    setResizeState(null);
    resizeAbortController?.abort();
    resizeAbortController = undefined;
  };

  const beginResize: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0 || props.locked) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeAbortController?.abort();
    props.onStartOptimisticFront(props.item.id);

    const scale = Math.max(props.viewportScale, 0.001);
    const stopInteraction = startHotInteraction({ kind: 'drag', cursor: 'nwse-resize' });

    setResizeState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: props.item.width,
      startHeight: props.item.height,
      width: props.item.width,
      height: props.item.height,
      scale,
      stopInteraction,
    });

    const handleMove = (nextEvent: PointerEvent) => {
      setResizeState((current) => {
        if (!current || current.pointerId !== nextEvent.pointerId) {
          return current;
        }
        return {
          ...current,
          width: Math.max(MIN_WIDTH, current.startWidth + (nextEvent.clientX - current.startClientX) / current.scale),
          height: Math.max(MIN_HEIGHT, current.startHeight + (nextEvent.clientY - current.startClientY) / current.scale),
        };
      });
    };

    const finish = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId === event.pointerId) {
        finishResize(true);
      }
    };

    const cancel = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId === event.pointerId) {
        finishResize(false);
      }
    };

    const controller = new AbortController();
    resizeAbortController = controller;
    window.addEventListener('pointermove', handleMove, { signal: controller.signal });
    window.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
    window.addEventListener('pointercancel', cancel, { once: true, signal: controller.signal });
  };

  return (
    <article
      class="workbench-widget"
      classList={{
        'is-selected': props.selected,
        'is-dragging': isDragging(),
        'is-resizing': isResizing(),
        'is-filtered-out': props.filtered,
      }}
      data-redeven-workbench-widget-id={props.item.id}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onContextMenu(event, props.item);
      }}
      onClick={() => {
        props.onSelect(props.item.id);
        props.onCommitFront(props.item.id);
      }}
      style={{
        transform: `translate(${livePosition().x}px, ${livePosition().y}px)`,
        width: `${liveSize().width}px`,
        height: `${liveSize().height}px`,
        'z-index': isDragging() || isResizing() || props.optimisticFront ? `${props.topZIndex + 1}` : `${props.item.z_index}`,
      }}
    >
      <header class="workbench-widget__header">
        <button
          type="button"
          class="workbench-widget__drag"
          aria-label="Drag widget"
          data-floe-canvas-interactive="true"
          onPointerDown={beginDrag}
        >
          <GripVertical class="h-3.5 w-3.5" />
        </button>
        <div class="workbench-widget__title-area">
          {(() => {
            const Icon = props.definition.icon;
            return <Icon class="h-3.5 w-3.5" />;
          })()}
          <span class="workbench-widget__title">{props.item.title}</span>
        </div>
        <button
          type="button"
          class="workbench-widget__close"
          aria-label="Remove widget"
          data-floe-canvas-interactive="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onRequestDelete(props.item.id);
          }}
        >
          <X class="h-3 w-3" />
        </button>
      </header>
      <div class="workbench-widget__body" data-floe-canvas-interactive="true">
        {(() => {
          const Body = props.definition.body;
          return <Body widgetId={props.item.id} title={props.item.title} type={props.item.type} />;
        })()}
      </div>
      {props.locked ? null : (
        <div
          class="workbench-widget__resize"
          aria-label="Resize widget"
          data-floe-canvas-interactive="true"
          onPointerDown={beginResize}
        >
          <svg class="workbench-widget__resize-glyph" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M12 0 L0 12" />
            <path d="M12 4 L4 12" />
            <path d="M12 8 L8 12" />
          </svg>
        </div>
      )}
    </article>
  );
}
