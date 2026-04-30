import { createEffect, onCleanup } from 'solid-js';
import {
  WorkbenchSurface,
  type WorkbenchContextMenuItemsResolver,
  type WorkbenchSurfaceApi,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import {
  findRedevenTerminalWheelSurface,
  redevenWorkbenchInteractionAdapter,
  REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR,
  REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR,
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
  resolveWorkbenchSurfaceTargetRole,
  resolveWorkbenchWheelRouting,
} from './workbenchInputRouting';
import { ensureWorkbenchTextSelectionSurfaceContract } from './workbenchTextSelectionSurface';
import {
  REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
  createWorkbenchOverviewViewport,
} from '../runtimeWorkbenchLayout';

const FORWARDED_CANVAS_WHEEL_EVENTS = new WeakSet<WheelEvent>();
const WORKBENCH_CANVAS_SELECTOR = '.floe-infinite-canvas';
const WORKBENCH_PROJECTED_LAYER_SELECTOR = '.workbench-canvas__projected-layer';
const WORKBENCH_VIEWPORT_PAN_START_DISTANCE_PX = 3;
const WORKBENCH_VIEWPORT_WHEEL_SETTLE_MS = 180;
const WORKBENCH_VIEWPORT_PROGRAMMATIC_SETTLE_MS = 260;
const WORKBENCH_WIDGET_VIEWPORT_CONTROL_SELECTOR = [
  '.workbench-widget__traffic-dot--min',
  '.workbench-widget__traffic-dot--max',
  '.workbench-widget__window-control--min',
  '.workbench-widget__window-control--max',
  'button[aria-label="Minimize widget to overview"]',
  'button[aria-label="Zoom widget to fit viewport"]',
].join(',');
const TERMINAL_SURFACE_SELECTOR = '.redeven-terminal-surface';
const TERMINAL_FREEZE_ATTR = 'data-redeven-terminal-freeze';
const TERMINAL_FREEZE_SNAPSHOT_CLASS = 'redeven-terminal-freeze-snapshot';

export interface RedevenWorkbenchSurfaceApi extends WorkbenchSurfaceApi {
  unfocusWidget: (widget: WorkbenchWidgetItem) => WorkbenchWidgetItem;
  enterOverview: () => void;
  runViewportTransition: <T>(action: () => T, options?: RedevenWorkbenchViewportTransitionOptions) => T;
}

export type RedevenWorkbenchContextMenuItemsResolver = WorkbenchContextMenuItemsResolver;
export type RedevenWorkbenchViewportTransitionReason =
  | 'programmatic'
  | 'widget_control'
  | 'hud_control';

export type RedevenWorkbenchViewportTransitionOptions = {
  reason?: RedevenWorkbenchViewportTransitionReason;
  settleMs?: number;
};

export interface RedevenWorkbenchSurfaceProps {
  state: () => WorkbenchState;
  setState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
  lockShortcut?: string | null;
  enableKeyboard?: boolean;
  class?: string;
  widgetDefinitions?: readonly WorkbenchWidgetDefinition[];
  filterBarWidgetTypes?: readonly WorkbenchWidgetType[];
  resolveContextMenuItems?: RedevenWorkbenchContextMenuItemsResolver;
  onApiReady?: (api: RedevenWorkbenchSurfaceApi | null) => void;
  onRequestDelete?: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
  onViewportInteractionPulse?: () => void;
  onViewportInteractionStart?: () => void;
  onViewportInteractionEnd?: () => void;
}

function createRedevenWorkbenchSurfaceApi(
  api: WorkbenchSurfaceApi,
  options: Readonly<{
    host: () => HTMLDivElement | undefined;
    commitState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
    runViewportTransition: <T>(
      action: () => T,
      transitionOptions?: RedevenWorkbenchViewportTransitionOptions,
    ) => T;
  }>,
): RedevenWorkbenchSurfaceApi {
  const resolveCanvasFrameSize = (): { width: number; height: number } => {
    const frame = options.host()?.querySelector('[data-floe-workbench-canvas-frame="true"]') as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    return {
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    };
  };

  return {
    ...api,
    fitWidget: (widget) => options.runViewportTransition(
      () => api.fitWidget(widget),
      { reason: 'hud_control' },
    ),
    overviewWidget: (widget) => options.runViewportTransition(
      () => api.overviewWidget(widget),
      { reason: 'hud_control' },
    ),
    unfocusWidget: (widget) => options.runViewportTransition(
      () => api.overviewWidget(widget),
      { reason: 'hud_control' },
    ),
    enterOverview: () => {
      options.runViewportTransition(() => {
        api.clearSelection();
        const frameSize = resolveCanvasFrameSize();
        options.commitState((previous) => ({
          ...previous,
          viewport: createWorkbenchOverviewViewport({
            widgets: previous.widgets,
            frameWidth: frameSize.width,
            frameHeight: frameSize.height,
            fallbackViewport: {
              x: 0,
              y: 0,
              scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
            },
          }),
          selectedWidgetId: null,
        }));
      }, { reason: 'hud_control' });
    },
    runViewportTransition: options.runViewportTransition,
  };
}

function createForwardedCanvasWheelEvent(source: WheelEvent): WheelEvent {
  return new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    composed: true,
    deltaMode: source.deltaMode,
    deltaX: source.deltaX,
    deltaY: source.deltaY,
    deltaZ: source.deltaZ,
    screenX: source.screenX,
    screenY: source.screenY,
    clientX: source.clientX,
    clientY: source.clientY,
    ctrlKey: source.ctrlKey,
    shiftKey: source.shiftKey,
    altKey: source.altKey,
    metaKey: source.metaKey,
    button: source.button,
    buttons: source.buttons,
  });
}

function resetProjectedLayerScroll(layer: HTMLElement) {
  if (layer.scrollTop !== 0) {
    layer.scrollTop = 0;
  }
  if (layer.scrollLeft !== 0) {
    layer.scrollLeft = 0;
  }
}

function resolveEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

function isWorkbenchCanvasEventTarget(host: HTMLElement, target: EventTarget | null): boolean {
  const element = resolveEventElement(target);
  if (!element) {
    return false;
  }

  const canvas = element.closest(WORKBENCH_CANVAS_SELECTOR);
  if (!(canvas instanceof HTMLElement) || !host.contains(canvas)) {
    return false;
  }

  const role = resolveWorkbenchSurfaceTargetRole({
    target,
    interactiveSelector: REDEVEN_WORKBENCH_INTERACTIVE_SELECTOR,
    panSurfaceSelector: REDEVEN_WORKBENCH_PAN_SURFACE_SELECTOR,
  });
  return role === 'canvas' || role === 'pan_surface';
}

function isWorkbenchWidgetViewportControlTarget(host: HTMLElement, target: EventTarget | null): boolean {
  const element = resolveEventElement(target);
  const control = element?.closest(WORKBENCH_WIDGET_VIEWPORT_CONTROL_SELECTOR);
  return Boolean(control instanceof HTMLElement && host.contains(control));
}

function isVisibleTerminalSurface(rect: DOMRect): boolean {
  if (rect.width <= 2 || rect.height <= 2) {
    return false;
  }
  if (typeof window === 'undefined') {
    return true;
  }
  return rect.right >= -64
    && rect.bottom >= -64
    && rect.left <= window.innerWidth + 64
    && rect.top <= window.innerHeight + 64;
}

function removeTerminalFreezeSnapshot(surface: HTMLElement) {
  const snapshot = surface.querySelector(`.${TERMINAL_FREEZE_SNAPSHOT_CLASS}`);
  snapshot?.remove();
  surface.removeAttribute(TERMINAL_FREEZE_ATTR);
}

function captureTerminalSurfaceSnapshot(surface: HTMLElement) {
  const rect = surface.getBoundingClientRect();
  if (!isVisibleTerminalSurface(rect)) {
    removeTerminalFreezeSnapshot(surface);
    return;
  }

  const sourceCanvases = Array.from(surface.querySelectorAll('canvas'))
    .filter((canvas): canvas is HTMLCanvasElement => (
      canvas instanceof HTMLCanvasElement
        && !canvas.classList.contains(TERMINAL_FREEZE_SNAPSHOT_CLASS)
    ));
  if (sourceCanvases.length === 0) {
    removeTerminalFreezeSnapshot(surface);
    return;
  }

  const cssWidth = surface.clientWidth || rect.width;
  const cssHeight = surface.clientHeight || rect.height;
  if (cssWidth <= 2 || cssHeight <= 2) {
    removeTerminalFreezeSnapshot(surface);
    return;
  }

  const dpr = 1;
  const snapshot = document.createElement('canvas');
  snapshot.className = TERMINAL_FREEZE_SNAPSHOT_CLASS;
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.width = Math.max(1, Math.round(cssWidth * dpr));
  snapshot.height = Math.max(1, Math.round(cssHeight * dpr));
  snapshot.style.width = `${cssWidth}px`;
  snapshot.style.height = `${cssHeight}px`;

  const ctx = snapshot.getContext('2d', { alpha: false });
  if (!ctx) {
    return;
  }

  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(surface).backgroundColor || '#000';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const scaleX = rect.width > 0 ? cssWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? cssHeight / rect.height : 1;
  for (const source of sourceCanvases) {
    const sourceRect = source.getBoundingClientRect();
    const targetX = (sourceRect.left - rect.left) * scaleX;
    const targetY = (sourceRect.top - rect.top) * scaleY;
    const targetWidth = sourceRect.width * scaleX;
    const targetHeight = sourceRect.height * scaleY;
    if (targetWidth <= 0 || targetHeight <= 0) {
      continue;
    }
    ctx.drawImage(source, 0, 0, source.width, source.height, targetX, targetY, targetWidth, targetHeight);
  }

  removeTerminalFreezeSnapshot(surface);
  surface.append(snapshot);
  surface.setAttribute(TERMINAL_FREEZE_ATTR, 'true');
}

function captureTerminalFreezeSnapshots(host: HTMLElement) {
  const surfaces = host.querySelectorAll(TERMINAL_SURFACE_SELECTOR);
  for (const surface of surfaces) {
    if (surface instanceof HTMLElement) {
      captureTerminalSurfaceSnapshot(surface);
    }
  }
}

function clearTerminalFreezeSnapshots(host: HTMLElement) {
  const surfaces = host.querySelectorAll(`[${TERMINAL_FREEZE_ATTR}="true"]`);
  for (const surface of surfaces) {
    if (surface instanceof HTMLElement) {
      removeTerminalFreezeSnapshot(surface);
    }
  }
}

function installProjectedLayerScrollGuard(host: HTMLElement): () => void {
  const layerCleanups = new Map<HTMLElement, () => void>();

  const guardLayer = (layer: HTMLElement) => {
    if (layerCleanups.has(layer)) return;

    const handleScroll = () => resetProjectedLayerScroll(layer);
    resetProjectedLayerScroll(layer);
    layer.addEventListener('scroll', handleScroll, { passive: true });
    layerCleanups.set(layer, () => {
      layer.removeEventListener('scroll', handleScroll);
    });
  };

  const syncLayers = () => {
    for (const [layer, cleanup] of layerCleanups) {
      if (!host.contains(layer)) {
        cleanup();
        layerCleanups.delete(layer);
      }
    }

    const layers = host.querySelectorAll(WORKBENCH_PROJECTED_LAYER_SELECTOR);
    for (const layer of layers) {
      if (layer instanceof HTMLElement) {
        guardLayer(layer);
      }
    }
  };

  syncLayers();

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(syncLayers);
    observer.observe(host, { childList: true, subtree: true });
  }

  return () => {
    observer?.disconnect();
    for (const cleanup of layerCleanups.values()) {
      cleanup();
    }
    layerCleanups.clear();
  };
}

export function RedevenWorkbenchSurface(props: RedevenWorkbenchSurfaceProps) {
  let hostRef: HTMLDivElement | undefined;
  let viewportInteractionActive = false;
  let viewportInteractionHolds = 0;
  let viewportWheelRelease: (() => void) | null = null;
  let terminalFreezeClearFrame: number | undefined;
  let terminalFreezeRefreshToken = 0;
  const programmaticViewportReleaseTimers = new Set<number>();

  createEffect(() => {
    const host = hostRef;
    if (!host) return;

    const dispose = installProjectedLayerScrollGuard(host);
    onCleanup(dispose);
  });

  createEffect(() => {
    const host = hostRef;
    if (!host) return;

    let viewportPanCandidate: {
      pointerId: number;
      startClientX: number;
      startClientY: number;
      release: () => void;
    } | null = null;
    let viewportWheelSettleTimer: number | undefined;

    const cancelViewportWheelSettle = () => {
      if (viewportWheelSettleTimer === undefined) {
        return;
      }
      window.clearTimeout(viewportWheelSettleTimer);
      viewportWheelSettleTimer = undefined;
    };

    const releaseWheelInteraction = () => {
      cancelViewportWheelSettle();
      viewportWheelRelease?.();
      viewportWheelRelease = null;
    };

    const handleWidgetTextSelectionPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.pointerType === 'touch') return;

      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const widgetRoot = target?.closest(`[${REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR}="true"]`) ?? null;
      if (!widgetRoot) return;

      ensureWorkbenchTextSelectionSurfaceContract({
        target: event.target,
        widgetRoot,
      });
    };
    const handleCanvasViewportPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.pointerType === 'touch') return;
      if (!isWorkbenchCanvasEventTarget(host, event.target)) return;

      viewportPanCandidate = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        release: beginViewportInteraction({ captureNow: false, refreshAfterEvent: true }),
      };
    };
    const handleCanvasViewportPointerMoveCapture = (event: PointerEvent) => {
      const candidate = viewportPanCandidate;
      if (!candidate || event.pointerId !== candidate.pointerId) return;

      const deltaX = event.clientX - candidate.startClientX;
      const deltaY = event.clientY - candidate.startClientY;
      if (
        Math.abs(deltaX) <= WORKBENCH_VIEWPORT_PAN_START_DISTANCE_PX
        && Math.abs(deltaY) <= WORKBENCH_VIEWPORT_PAN_START_DISTANCE_PX
      ) {
        return;
      }
      props.onViewportInteractionPulse?.();
    };
    const handleCanvasViewportPointerEndCapture = (event: PointerEvent) => {
      const candidate = viewportPanCandidate;
      if (!candidate || event.pointerId !== candidate.pointerId) return;
      viewportPanCandidate = null;
      candidate.release();
    };
    const handleWidgetViewportControlClickCapture = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (!isWorkbenchWidgetViewportControlTarget(host, event.target)) return;
      runViewportTransition(() => undefined, {
        reason: 'widget_control',
        settleMs: WORKBENCH_VIEWPORT_PROGRAMMATIC_SETTLE_MS,
      });
    };
    const handleTerminalWheelCapture = (event: WheelEvent) => {
      if (FORWARDED_CANVAS_WHEEL_EVENTS.has(event)) {
        FORWARDED_CANVAS_WHEEL_EVENTS.delete(event);
        return;
      }

      if (!findRedevenTerminalWheelSurface(event.target)) return;

      const state = props.state();
      const routing = resolveWorkbenchWheelRouting({
        target: event.target,
        disablePanZoom: state.locked,
        selectedWidgetId: state.selectedWidgetId,
      });
      if (routing.kind === 'local_surface') return;

      event.preventDefault();
      event.stopPropagation();

      if (routing.kind !== 'canvas_zoom') return;

      const canvas = host.querySelector(WORKBENCH_CANVAS_SELECTOR);
      if (!(canvas instanceof HTMLElement)) return;

      const forwarded = createForwardedCanvasWheelEvent(event);
      FORWARDED_CANVAS_WHEEL_EVENTS.add(forwarded);
      canvas.dispatchEvent(forwarded);
    };
    const handleCanvasViewportWheelCapture = (event: WheelEvent) => {
      const state = props.state();
      const routing = resolveWorkbenchWheelRouting({
        target: event.target,
        disablePanZoom: state.locked,
        selectedWidgetId: state.selectedWidgetId,
      });
      if (routing.kind !== 'canvas_zoom') return;
      if (!isWorkbenchCanvasEventTarget(host, event.target)) return;

      if (!viewportWheelRelease) {
        viewportWheelRelease = beginViewportInteraction({ captureNow: true });
      } else {
        props.onViewportInteractionPulse?.();
      }
      cancelViewportWheelSettle();
      viewportWheelSettleTimer = window.setTimeout(() => {
        viewportWheelSettleTimer = undefined;
        releaseWheelInteraction();
      }, WORKBENCH_VIEWPORT_WHEEL_SETTLE_MS);
    };

    host.addEventListener('pointerdown', handleWidgetTextSelectionPointerDownCapture, {
      capture: true,
      passive: true,
    });
    host.addEventListener('pointerdown', handleCanvasViewportPointerDownCapture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('pointermove', handleCanvasViewportPointerMoveCapture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('pointerup', handleCanvasViewportPointerEndCapture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('pointercancel', handleCanvasViewportPointerEndCapture, {
      capture: true,
      passive: true,
    });
    host.addEventListener('click', handleWidgetViewportControlClickCapture, {
      capture: true,
      passive: true,
    });
    host.addEventListener('wheel', handleTerminalWheelCapture, {
      capture: true,
      passive: false,
    });
    host.addEventListener('wheel', handleCanvasViewportWheelCapture, {
      capture: true,
      passive: true,
    });

    onCleanup(() => {
      viewportPanCandidate?.release();
      viewportPanCandidate = null;
      terminalFreezeRefreshToken += 1;
      releaseWheelInteraction();
      clearTerminalFreezeSnapshots(host);
      host.removeEventListener('pointerdown', handleWidgetTextSelectionPointerDownCapture, true);
      host.removeEventListener('pointerdown', handleCanvasViewportPointerDownCapture, true);
      window.removeEventListener('pointermove', handleCanvasViewportPointerMoveCapture, true);
      window.removeEventListener('pointerup', handleCanvasViewportPointerEndCapture, true);
      window.removeEventListener('pointercancel', handleCanvasViewportPointerEndCapture, true);
      host.removeEventListener('click', handleWidgetViewportControlClickCapture, true);
      host.removeEventListener('wheel', handleTerminalWheelCapture, true);
      host.removeEventListener('wheel', handleCanvasViewportWheelCapture, true);
    });
  });

  const cancelTerminalFreezeClear = () => {
    if (terminalFreezeClearFrame === undefined) {
      return;
    }
    window.cancelAnimationFrame(terminalFreezeClearFrame);
    terminalFreezeClearFrame = undefined;
  };

  const scheduleTerminalFreezeRefresh = (host: HTMLElement) => {
    const token = ++terminalFreezeRefreshToken;
    const enqueue = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback: () => void) => { void Promise.resolve().then(callback); };
    enqueue(() => {
      if (token !== terminalFreezeRefreshToken || !viewportInteractionActive) {
        return;
      }
      captureTerminalFreezeSnapshots(host);
    });
  };

  const scheduleTerminalFreezeClear = (host: HTMLElement) => {
    cancelTerminalFreezeClear();
    terminalFreezeClearFrame = window.requestAnimationFrame(() => {
      terminalFreezeClearFrame = window.requestAnimationFrame(() => {
        terminalFreezeClearFrame = undefined;
        clearTerminalFreezeSnapshots(host);
      });
    });
  };

  const beginViewportInteraction = (
    opts?: { captureNow?: boolean; refreshAfterEvent?: boolean },
  ): (() => void) => {
    const host = hostRef;
    if (!host) {
      return () => undefined;
    }

    cancelTerminalFreezeClear();
    viewportInteractionHolds += 1;
    if (!viewportInteractionActive) {
      if (opts?.captureNow !== false) {
        captureTerminalFreezeSnapshots(host);
      }
      viewportInteractionActive = true;
      props.onViewportInteractionStart?.();
    }
    if (opts?.refreshAfterEvent) {
      scheduleTerminalFreezeRefresh(host);
    }
    props.onViewportInteractionPulse?.();

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      viewportInteractionHolds = Math.max(0, viewportInteractionHolds - 1);
      if (viewportInteractionHolds > 0 || !viewportInteractionActive) {
        return;
      }
      viewportInteractionActive = false;
      terminalFreezeRefreshToken += 1;
      props.onViewportInteractionEnd?.();
      scheduleTerminalFreezeClear(host);
    };
  };

  const runViewportTransition = <T,>(
    action: () => T,
    options?: RedevenWorkbenchViewportTransitionOptions,
  ): T => {
    const release = beginViewportInteraction({ captureNow: true });
    try {
      return action();
    } finally {
      const settleMs = Math.max(0, options?.settleMs ?? WORKBENCH_VIEWPORT_PROGRAMMATIC_SETTLE_MS);
      const timer = window.setTimeout(() => {
        programmaticViewportReleaseTimers.delete(timer);
        release();
      }, settleMs);
      programmaticViewportReleaseTimers.add(timer);
    }
  };

  onCleanup(() => {
    for (const timer of programmaticViewportReleaseTimers) {
      window.clearTimeout(timer);
    }
    programmaticViewportReleaseTimers.clear();
    viewportWheelRelease?.();
    viewportWheelRelease = null;
    viewportInteractionHolds = 0;
    viewportInteractionActive = false;
    terminalFreezeRefreshToken += 1;
    cancelTerminalFreezeClear();
    const host = hostRef;
    if (host) {
      clearTerminalFreezeSnapshots(host);
    }
  });

  return (
    <div ref={hostRef} class="h-full min-h-0">
      <WorkbenchSurface
        state={props.state}
        setState={props.setState}
        lockShortcut={props.lockShortcut}
        enableKeyboard={props.enableKeyboard}
        class={props.class}
        widgetDefinitions={props.widgetDefinitions}
        launcherWidgetTypes={props.filterBarWidgetTypes}
        interactionAdapter={redevenWorkbenchInteractionAdapter}
        resolveContextMenuItems={props.resolveContextMenuItems}
        onApiReady={(api) => props.onApiReady?.(api
          ? createRedevenWorkbenchSurfaceApi(api, {
            host: () => hostRef,
            commitState: props.setState,
            runViewportTransition,
          })
          : null)}
        onRequestDelete={props.onRequestDelete}
        onLayoutInteractionStart={props.onLayoutInteractionStart}
        onLayoutInteractionEnd={props.onLayoutInteractionEnd}
      />
    </div>
  );
}
