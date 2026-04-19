import { createEffect, createSignal, onCleanup, untrack, type JSX } from 'solid-js';

import { startWorkbenchHotInteraction } from './workbenchHotInteraction';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_SELECTOR } from './workbenchWheelInteractive';
import { resolveWorkbenchSurfaceTargetRole, resolveWorkbenchWheelRouting } from './workbenchInputRouting';

const DEFAULT_SCALE = 1;
const DEFAULT_MIN_SCALE = 0.45;
const DEFAULT_MAX_SCALE = 2.2;
const DEFAULT_WHEEL_ZOOM_SPEED = 0.0014;
const DEFAULT_PAN_SURFACE_SELECTOR = '[data-floe-canvas-pan-surface="true"]';
const PAN_START_THRESHOLD = 3;

export interface InfiniteCanvasPoint {
  x: number;
  y: number;
  scale: number;
}

export interface InfiniteCanvasContextMenuEvent {
  clientX: number;
  clientY: number;
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
}

export interface RedevenInfiniteCanvasProps {
  children: JSX.Element;
  viewport: InfiniteCanvasPoint;
  onViewportChange?: (viewport: InfiniteCanvasPoint) => void;
  onCanvasContextMenu?: (event: InfiniteCanvasContextMenuEvent) => void;
  ariaLabel?: string;
  class?: string;
  contentClass?: string;
  interactiveSelector?: string;
  panSurfaceSelector?: string;
  wheelInteractiveSelector?: string;
  minScale?: number;
  maxScale?: number;
  wheelZoomSpeed?: number;
  /** When true, wheel zoom and pan are suppressed. Widgets inside remain interactive. */
  disablePanZoom?: boolean;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: InfiniteCanvasPoint;
  moved: boolean;
  startedFromPanSurface: boolean;
  stopInteraction?: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeViewport(viewport: InfiniteCanvasPoint): InfiniteCanvasPoint {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    scale: Number.isFinite(viewport.scale) && viewport.scale > 0 ? viewport.scale : DEFAULT_SCALE,
  };
}

function resolveWheelDelta(event: WheelEvent, root: HTMLDivElement | undefined): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * (root?.clientHeight ?? window.innerHeight);
  return event.deltaY;
}

export function RedevenInfiniteCanvas(props: RedevenInfiniteCanvasProps) {
  const [liveViewport, setLiveViewport] = createSignal<InfiniteCanvasPoint>(
    untrack(() => sanitizeViewport(props.viewport))
  );
  const [dragState, setDragState] = createSignal<DragState | null>(null);
  let rootRef: HTMLDivElement | undefined;
  let wheelCommitTimer: number | undefined;
  let suppressPanSurfaceClick = false;
  let clearPanSurfaceClickTimer: number | undefined;

  const interactiveSelector = () =>
    props.interactiveSelector ?? '[data-floe-canvas-interactive="true"]';
  const panSurfaceSelector = () => props.panSurfaceSelector ?? DEFAULT_PAN_SURFACE_SELECTOR;
  const wheelInteractiveSelector = () =>
    props.wheelInteractiveSelector ?? REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_SELECTOR;
  const minScale = () => props.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = () => props.maxScale ?? DEFAULT_MAX_SCALE;
  const wheelZoomSpeed = () => props.wheelZoomSpeed ?? DEFAULT_WHEEL_ZOOM_SPEED;
  const isPanning = () => {
    const current = dragState();
    if (!current) return false;
    if (!current.startedFromPanSurface) return true;
    return current.moved;
  };

  const clearWheelCommitTimer = () => {
    if (wheelCommitTimer === undefined) return;
    window.clearTimeout(wheelCommitTimer);
    wheelCommitTimer = undefined;
  };

  const clearPanSurfaceClickSuppression = () => {
    suppressPanSurfaceClick = false;

    if (clearPanSurfaceClickTimer === undefined) return;
    window.clearTimeout(clearPanSurfaceClickTimer);
    clearPanSurfaceClickTimer = undefined;
  };

  const schedulePanSurfaceClickSuppressionReset = () => {
    if (typeof window === 'undefined') {
      suppressPanSurfaceClick = false;
      return;
    }

    if (clearPanSurfaceClickTimer !== undefined) {
      window.clearTimeout(clearPanSurfaceClickTimer);
    }

    clearPanSurfaceClickTimer = window.setTimeout(() => {
      clearPanSurfaceClickTimer = undefined;
      suppressPanSurfaceClick = false;
    }, 0);
  };

  const commitViewport = (next: InfiniteCanvasPoint) => {
    untrack(() => props.onViewportChange?.(next));
  };

  const scheduleViewportCommit = (next: InfiniteCanvasPoint) => {
    if (typeof window === 'undefined') {
      commitViewport(next);
      return;
    }

    clearWheelCommitTimer();
    wheelCommitTimer = window.setTimeout(() => {
      wheelCommitTimer = undefined;
      commitViewport(next);
    }, 90);
  };

  const resolveTargetRole = (target: EventTarget | null) => {
    return resolveWorkbenchSurfaceTargetRole({
      target,
      interactiveSelector: interactiveSelector(),
      panSurfaceSelector: panSurfaceSelector(),
    });
  };

  const releaseDrag = (pointerId?: number) => {
    const current = dragState();
    if (!current) return;
    if (pointerId !== undefined && current.pointerId !== pointerId) return;

    current.stopInteraction?.();
    const next = liveViewport();
    setDragState(null);

    if (rootRef && rootRef.hasPointerCapture(current.pointerId)) {
      rootRef.releasePointerCapture(current.pointerId);
    }

    if (current.startedFromPanSurface && current.moved) {
      suppressPanSurfaceClick = true;
      schedulePanSurfaceClickSuppressionReset();
    }

    commitViewport(next);
  };

  createEffect(() => {
    if (dragState()) return;
    setLiveViewport(sanitizeViewport(props.viewport));
  });

  createEffect(() => {
    const root = rootRef;
    if (!root) return;

    const handleClickCapture = (event: MouseEvent) => {
      if (!suppressPanSurfaceClick || resolveTargetRole(event.target) !== 'pan_surface') return;

      clearPanSurfaceClickSuppression();
      event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener('click', handleClickCapture, true);
    // Explicit `passive: false` — wheel zoom calls preventDefault() to stop
    // the page from scrolling while the user is zooming. Attaching this
    // manually avoids Chrome's "non-passive scroll-blocking listener"
    // violation warning that fires on implicit onWheel JSX bindings.
    root.addEventListener('wheel', handleWheel, { passive: false });

    onCleanup(() => {
      root.removeEventListener('click', handleClickCapture, true);
      root.removeEventListener('wheel', handleWheel);
    });
  });

  onCleanup(() => {
    clearWheelCommitTimer();
    releaseDrag();
    clearPanSurfaceClickSuppression();
  });

  const handlePointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0) return;
    if (props.disablePanZoom) return;

    const targetRole = resolveTargetRole(event.target);
    const startedFromPanSurface = targetRole === 'pan_surface';
    if (targetRole === 'local_surface') return;

    clearWheelCommitTimer();
    clearPanSurfaceClickSuppression();
    if (!startedFromPanSurface) {
      event.preventDefault();
      rootRef?.setPointerCapture(event.pointerId);
    }

    setDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: liveViewport(),
      moved: false,
      startedFromPanSurface,
      stopInteraction: startedFromPanSurface
        ? undefined
        : startWorkbenchHotInteraction({ kind: 'drag', cursor: 'grabbing' }),
    });
  };

  const handlePointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    const current = dragState();
    if (!current || current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - current.startClientX;
    const deltaY = event.clientY - current.startClientY;
    const moved =
      current.moved ||
      Math.abs(deltaX) > PAN_START_THRESHOLD ||
      Math.abs(deltaY) > PAN_START_THRESHOLD;

    if (!moved) return;

    if (!current.moved) {
      event.preventDefault();

      if (!rootRef?.hasPointerCapture(event.pointerId)) {
        rootRef?.setPointerCapture(event.pointerId);
      }
    }

    const next = {
      ...current.startViewport,
      x: current.startViewport.x + deltaX,
      y: current.startViewport.y + deltaY,
    };

    if (!current.moved) {
      setDragState({
        ...current,
        moved: true,
        stopInteraction:
          current.stopInteraction ?? startWorkbenchHotInteraction({ kind: 'drag', cursor: 'grabbing' }),
      });
    }

    setLiveViewport(next);
  };

  const handlePointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    releaseDrag(event.pointerId);
  };

  const handlePointerCancel: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    releaseDrag(event.pointerId);
  };

  // Plain-function signature (not a JSX.EventHandler) because this listener
  // is attached manually below with `{ passive: false }` — the browser warns
  // about implicit non-passive wheel listeners otherwise, since it can't tell
  // whether a JSX-bound handler plans to call preventDefault.
  const handleWheel = (event: WheelEvent) => {
    const rect = rootRef?.getBoundingClientRect();
    if (!rect) return;
    const routing = resolveWorkbenchWheelRouting({
      target: event.target,
      disablePanZoom: !!props.disablePanZoom,
      wheelInteractiveSelector: wheelInteractiveSelector(),
    });
    if (routing.kind !== 'canvas_zoom') {
      return;
    }

    event.preventDefault();

    const current = liveViewport();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const rawDelta = resolveWheelDelta(event, rootRef);
    const nextScale = clamp(
      current.scale * Math.exp(-rawDelta * wheelZoomSpeed()),
      minScale(),
      maxScale()
    );

    if (Math.abs(nextScale - current.scale) < 0.0001) return;

    const worldX = (localX - current.x) / current.scale;
    const worldY = (localY - current.y) / current.scale;
    const next = {
      x: localX - worldX * nextScale,
      y: localY - worldY * nextScale,
      scale: nextScale,
    };

    setLiveViewport(next);
    scheduleViewportCommit(next);
  };

  const handleContextMenu: JSX.EventHandler<HTMLDivElement, MouseEvent> = (event) => {
    if (resolveTargetRole(event.target) !== 'canvas') return;

    const rect = rootRef?.getBoundingClientRect();
    if (!rect) return;

    event.preventDefault();

    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const viewport = liveViewport();

    props.onCanvasContextMenu?.({
      clientX: event.clientX,
      clientY: event.clientY,
      localX,
      localY,
      worldX: (localX - viewport.x) / viewport.scale,
      worldY: (localY - viewport.y) / viewport.scale,
    });
  };

  return (
    <div
      ref={rootRef}
      class={[
        'floe-infinite-canvas',
        isPanning() ? 'is-panning' : '',
        props.disablePanZoom ? 'is-locked' : '',
        props.class ?? '',
      ].filter(Boolean).join(' ')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
      aria-label={props.ariaLabel ?? 'Infinite canvas'}
    >
      <div
        class={['floe-infinite-canvas__viewport', props.contentClass ?? ''].filter(Boolean).join(' ')}
        style={{
          transform: `translate(${liveViewport().x}px, ${liveViewport().y}px) scale(${liveViewport().scale})`,
          'transform-origin': '0 0',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
