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
  REDEVEN_WORKBENCH_WIDGET_ROOT_ATTR,
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

export interface RedevenWorkbenchSurfaceApi extends WorkbenchSurfaceApi {
  unfocusWidget: (widget: WorkbenchWidgetItem) => WorkbenchWidgetItem;
  enterOverview: () => void;
}

export type RedevenWorkbenchContextMenuItemsResolver = WorkbenchContextMenuItemsResolver;

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
}

function createRedevenWorkbenchSurfaceApi(
  api: WorkbenchSurfaceApi,
  options: Readonly<{
    host: () => HTMLDivElement | undefined;
    commitState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
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
    unfocusWidget: (widget) => api.overviewWidget(widget),
    enterOverview: () => {
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
    },
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

  createEffect(() => {
    const host = hostRef;
    if (!host) return;

    const dispose = installProjectedLayerScrollGuard(host);
    onCleanup(dispose);
  });

  createEffect(() => {
    const host = hostRef;
    if (!host) return;

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

    host.addEventListener('pointerdown', handleWidgetTextSelectionPointerDownCapture, {
      capture: true,
      passive: true,
    });
    host.addEventListener('wheel', handleTerminalWheelCapture, {
      capture: true,
      passive: false,
    });

    onCleanup(() => {
      host.removeEventListener('pointerdown', handleWidgetTextSelectionPointerDownCapture, true);
      host.removeEventListener('wheel', handleTerminalWheelCapture, true);
    });
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
          })
          : null)}
        onRequestDelete={props.onRequestDelete}
        onLayoutInteractionStart={props.onLayoutInteractionStart}
        onLayoutInteractionEnd={props.onLayoutInteractionEnd}
      />
    </div>
  );
}
