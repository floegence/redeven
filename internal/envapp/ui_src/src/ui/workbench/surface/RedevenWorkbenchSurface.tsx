import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  WorkbenchContextMenu,
  useWorkbenchModel,
  type UseWorkbenchModelOptions,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { RedevenWorkbenchCanvas } from './RedevenWorkbenchCanvas';
import { RedevenWorkbenchFilterBar } from './RedevenWorkbenchFilterBar';
import { RedevenWorkbenchHud } from './RedevenWorkbenchHud';
import { RedevenWorkbenchLockButton } from './RedevenWorkbenchLockButton';
import {
  INITIAL_WORKBENCH_INPUT_OWNER,
  REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR,
  createCanvasInputOwner,
  createWidgetInputOwner,
  findWorkbenchWidgetRoot,
  focusWorkbenchWidgetElement,
  readWorkbenchWidgetId,
  shouldBypassWorkbenchGlobalHotkeys,
  type WorkbenchInputOwner,
} from './workbenchInputRouting';

const WORKBENCH_CANVAS_INTERACTIVE_SELECTOR = '[data-floe-canvas-interactive="true"]';
const WORKBENCH_CANVAS_MEASUREMENT_SELECTOR = '.workbench-canvas';

export interface RedevenWorkbenchSurfaceApi {
  ensureWidget: (
    type: WorkbenchWidgetType,
    options?: { centerViewport?: boolean; worldX?: number; worldY?: number },
  ) => WorkbenchWidgetItem | null;
  focusWidget: (
    widget: WorkbenchWidgetItem,
    options?: { centerViewport?: boolean },
  ) => WorkbenchWidgetItem;
  findWidgetByType: (type: WorkbenchWidgetType) => WorkbenchWidgetItem | null;
}

export interface RedevenWorkbenchSurfaceProps {
  state: () => WorkbenchState;
  setState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
  /**
   * Keyboard shortcut key for toggling lock mode. Matches `KeyboardEvent.key`.
   * Defaults to "F1". Pass `null` to disable the shortcut entirely.
   */
  lockShortcut?: string | null;
  /**
   * If true, owns global keyboard handlers (arrows, lock, delete). Set to
   * false when the surface is embedded in a parent that drives those keys
   * itself. Defaults to true.
   */
  enableKeyboard?: boolean;
  /**
   * Optional class added to the surface root for layout integration.
   */
  class?: string;
  widgetDefinitions?: readonly WorkbenchWidgetDefinition[];
  onApiReady?: (api: RedevenWorkbenchSurfaceApi | null) => void;
}

const DEFAULT_LOCK_SHORTCUT = 'F1';

export function RedevenWorkbenchSurface(props: RedevenWorkbenchSurfaceProps) {
  const modelOptions: UseWorkbenchModelOptions = {
    state: () => props.state(),
    setState: (updater) => props.setState(updater),
    widgetDefinitions: () => props.widgetDefinitions,
    onClose: () => {
      // Page mode has no "close" — surface is a permanent display, not a modal.
    },
  };

  const model = useWorkbenchModel(modelOptions);
  const [surfaceRootEl, setSurfaceRootEl] = createSignal<HTMLDivElement | null>(null);
  const [inputOwner, setInputOwner] = createSignal<WorkbenchInputOwner>(INITIAL_WORKBENCH_INPUT_OWNER);

  const updateInputOwnerFromTarget = (
    target: EventTarget | null,
    widgetReason: 'pointer' | 'focus' | 'activation',
    canvasReason: 'background_pointer' | 'background_focus',
  ): void => {
    const widgetRoot = findWorkbenchWidgetRoot(target);
    const widgetId = readWorkbenchWidgetId(widgetRoot);
    if (widgetId) {
      setInputOwner(createWidgetInputOwner(widgetId, widgetReason));
      return;
    }

    const root = surfaceRootEl();
    if (root && target instanceof Node && root.contains(target)) {
      setInputOwner(createCanvasInputOwner(canvasReason));
    }
  };

  const refreshCanvasFrameMeasurement = (): HTMLDivElement | null => {
    const canvasEl = surfaceRootEl()?.querySelector(WORKBENCH_CANVAS_MEASUREMENT_SELECTOR) as HTMLDivElement | null;
    if (canvasEl) {
      model.setCanvasFrameRef(canvasEl);
    }
    return canvasEl;
  };

  createEffect(() => {
    props.onApiReady?.({
      ensureWidget: (type, options) => {
        refreshCanvasFrameMeasurement();
        return model.widgetActions.ensureWidget(type, options) ?? null;
      },
      focusWidget: (widget, options) => {
        refreshCanvasFrameMeasurement();
        const focusedWidget = model.navigation.focusWidget(widget, options);
        queueMicrotask(() => {
          focusWorkbenchWidgetElement(surfaceRootEl(), focusedWidget.id);
          setInputOwner(createWidgetInputOwner(focusedWidget.id, 'activation'));
        });
        return focusedWidget;
      },
      findWidgetByType: (type) => model.queries.findWidgetByType(type),
    });

    onCleanup(() => {
      props.onApiReady?.(null);
    });
  });

  const lockShortcut = () =>
    props.lockShortcut === undefined ? DEFAULT_LOCK_SHORTCUT : props.lockShortcut;

  createEffect(() => {
    const owner = inputOwner();
    if (owner.kind !== 'widget') return;

    const widgetStillExists = model.widgets().some((widget) => widget.id === owner.widgetId);
    if (!widgetStillExists) {
      setInputOwner(createCanvasInputOwner('widget_removed'));
    }
  });

  createEffect(() => {
    const root = surfaceRootEl();
    if (!root) return;

    const handlePointerDownCapture = (event: PointerEvent) => {
      updateInputOwnerFromTarget(event.target, 'pointer', 'background_pointer');
    };
    const handleFocusIn = (event: FocusEvent) => {
      updateInputOwnerFromTarget(event.target, 'focus', 'background_focus');
    };

    root.addEventListener('pointerdown', handlePointerDownCapture, true);
    root.addEventListener('focusin', handleFocusIn);

    onCleanup(() => {
      root.removeEventListener('pointerdown', handlePointerDownCapture, true);
      root.removeEventListener('focusin', handleFocusIn);
    });
  });

  // Keyboard handler for arrow navigation, lock toggle, and deleting the selected widget.
  createEffect(() => {
    if (props.enableKeyboard === false) return;
    if (typeof document === 'undefined') return;

    const shortcut = lockShortcut();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      if (shortcut !== null && event.key === shortcut) {
        event.preventDefault();
        model.lock.toggle();
        return;
      }

      if (shouldBypassWorkbenchGlobalHotkeys({
        root: surfaceRootEl(),
        target: event.target,
        owner: inputOwner(),
        interactiveSelector: WORKBENCH_CANVAS_INTERACTIVE_SELECTOR,
      })) {
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          refreshCanvasFrameMeasurement();
          model.navigation.handleArrowNavigation('up');
          break;
        case 'ArrowDown':
          event.preventDefault();
          refreshCanvasFrameMeasurement();
          model.navigation.handleArrowNavigation('down');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          refreshCanvasFrameMeasurement();
          model.navigation.handleArrowNavigation('left');
          break;
        case 'ArrowRight':
          event.preventDefault();
          refreshCanvasFrameMeasurement();
          model.navigation.handleArrowNavigation('right');
          break;
        case 'Delete':
        case 'Backspace':
          if (model.selectedWidgetId()) {
            event.preventDefault();
            model.widgetActions.deleteSelected();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown, true));
  });

  // Convert a client (viewport) point into world coords inside the canvas.
  // Returns null when the cursor is outside the canvas frame, so callers can
  // distinguish "dropped on canvas" from "dropped outside".
  const clientToWorld = (clientX: number, clientY: number) => {
    const frameEl = refreshCanvasFrameMeasurement();
    if (!frameEl) return null;
    const rect = frameEl.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const vp = model.viewport();
    return {
      worldX: (localX - vp.x) / vp.scale,
      worldY: (localY - vp.y) / vp.scale,
    };
  };

  const handleCreateAtClient = (type: WorkbenchWidgetType, clientX: number, clientY: number) => {
    const world = clientToWorld(clientX, clientY);
    if (!world) return;
    model.widgetActions.addWidgetAtCursor(type, world.worldX, world.worldY);
  };

  return (
    <div
      ref={setSurfaceRootEl}
      class={`workbench-surface${props.class ? ` ${props.class}` : ''}`}
      {...{ [REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR]: 'true' }}
    >
      <div class="workbench-surface__body" data-floe-workbench-canvas-frame="true">
        <RedevenWorkbenchCanvas
          widgetDefinitions={model.widgetDefinitions()}
          widgets={model.widgets()}
          viewport={model.viewport()}
          selectedWidgetId={model.selectedWidgetId()}
          optimisticFrontWidgetId={model.optimisticFrontWidgetId()}
          locked={model.locked()}
          filters={model.filters()}
          setCanvasFrameRef={model.setCanvasFrameRef}
          onViewportCommit={model.canvas.commitViewport}
          onCanvasContextMenu={model.canvas.openCanvasContextMenu}
          onSelectWidget={model.canvas.selectWidget}
          onWidgetContextMenu={model.canvas.openWidgetContextMenu}
          onStartOptimisticFront={model.canvas.startOptimisticFront}
          onCommitFront={model.canvas.commitFront}
          onCommitMove={model.canvas.commitMove}
          onCommitResize={model.canvas.commitResize}
          onRequestDelete={model.widgetActions.deleteWidget}
        />
      </div>

      <RedevenWorkbenchLockButton
        locked={model.locked()}
        onToggle={model.lock.toggle}
        shortcutLabel={lockShortcut() ?? undefined}
      />

      <RedevenWorkbenchFilterBar
        widgetDefinitions={model.widgetDefinitions()}
        widgets={model.widgets()}
        filters={model.filters()}
        onSoloFilter={model.filter.solo}
        onShowAll={model.filter.showAll}
        onCreateAt={handleCreateAtClient}
      />

      <RedevenWorkbenchHud
        scaleLabel={model.scaleLabel()}
        onZoomOut={model.hud.zoomOut}
        onZoomIn={model.hud.zoomIn}
      />

      <Show when={model.contextMenu.state()}>
        <Portal>
          <div
            class="workbench-menu-backdrop"
            data-floe-workbench-boundary="true"
            onClick={model.contextMenu.close}
            onContextMenu={model.contextMenu.retarget}
          />
          <WorkbenchContextMenu
            x={model.contextMenu.position()?.left ?? 0}
            y={model.contextMenu.position()?.top ?? 0}
            items={model.contextMenu.items()}
          />
        </Portal>
      </Show>
    </div>
  );
}
