import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
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
import type {
  WorkbenchAppearance,
  WorkbenchAppearanceTexture,
  WorkbenchAppearanceTone,
} from '../workbenchAppearance';
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
const WORKBENCH_CONTEXT_MENU_ATTR = 'data-floe-workbench-context-menu';

export interface RedevenWorkbenchSurfaceApi {
  ensureWidget: (
    type: WorkbenchWidgetType,
    options?: { centerViewport?: boolean; worldX?: number; worldY?: number },
  ) => WorkbenchWidgetItem | null;
  createWidget: (
    type: WorkbenchWidgetType,
    options?: { centerViewport?: boolean; worldX?: number; worldY?: number },
  ) => WorkbenchWidgetItem | null;
  focusWidget: (
    widget: WorkbenchWidgetItem,
    options?: { centerViewport?: boolean },
  ) => WorkbenchWidgetItem;
  fitWidget: (widget: WorkbenchWidgetItem) => WorkbenchWidgetItem;
  unfocusWidget: (widget: WorkbenchWidgetItem) => WorkbenchWidgetItem;
  clearSelection: () => void;
  findWidgetByType: (type: WorkbenchWidgetType) => WorkbenchWidgetItem | null;
  findWidgetById: (widgetId: string) => WorkbenchWidgetItem | null;
  updateWidgetTitle: (widgetId: string, title: string) => void;
}

export interface RedevenWorkbenchSurfaceProps {
  state: () => WorkbenchState;
  setState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
  appearance?: WorkbenchAppearance;
  onToneSelect?: (tone: WorkbenchAppearanceTone) => void;
  onTextureSelect?: (texture: WorkbenchAppearanceTexture) => void;
  onResetAppearance?: () => void;
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
  filterBarWidgetTypes?: readonly WorkbenchWidgetType[];
  onApiReady?: (api: RedevenWorkbenchSurfaceApi | null) => void;
  onRequestDelete?: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
}

const DEFAULT_LOCK_SHORTCUT = 'F1';

function isWorkbenchContextMenuEvent(event: Event): boolean {
  if (typeof event.composedPath === 'function') {
    for (const node of event.composedPath()) {
      if (
        node &&
        typeof node === 'object' &&
        'getAttribute' in node &&
        typeof node.getAttribute === 'function' &&
        node.getAttribute(WORKBENCH_CONTEXT_MENU_ATTR) === 'true'
      ) {
        return true;
      }
    }
  }

  return event.target instanceof Element
    && event.target.closest(`[${WORKBENCH_CONTEXT_MENU_ATTR}="true"]`) !== null;
}

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
  const manuallyAddableWidgetTypes = createMemo(() => {
    const allowedTypes = props.filterBarWidgetTypes;
    if (!allowedTypes || allowedTypes.length <= 0) {
      return null;
    }
    return new Set<WorkbenchWidgetType>(allowedTypes);
  });
  const filterBarWidgetDefinitions = createMemo(() => {
    const definitions = model.widgetDefinitions();
    const allowed = manuallyAddableWidgetTypes();
    if (!allowed) {
      return definitions;
    }
    return definitions.filter((entry) => allowed.has(entry.type));
  });
  const contextMenuItems = createMemo(() => {
    const items = model.contextMenu.items();
    const allowed = manuallyAddableWidgetTypes();
    if (!allowed) {
      return items;
    }
    return items.filter((item) => {
      if (item.kind !== 'action') {
        return true;
      }
      const addMatch = /^add-(.+)$/.exec(String(item.id ?? ''));
      if (!addMatch) {
        return true;
      }
      return allowed.has(addMatch[1] as WorkbenchWidgetType);
    });
  });

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

  createEffect(() => {
    const viewportWorldCenter = () => {
      const frameEl = surfaceRootEl()?.querySelector(
        '[data-floe-workbench-canvas-frame="true"]'
      ) as HTMLElement | null;
      const vp = model.viewport();
      const rect = frameEl?.getBoundingClientRect();
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;

      return {
        worldX: width > 0 ? (width / 2 - vp.x) / vp.scale : 240,
        worldY: height > 0 ? (height / 2 - vp.y) / vp.scale : 180,
      };
    };

    const focusWidgetRoot = (widgetId: string) => {
      queueMicrotask(() => {
        focusWorkbenchWidgetElement(surfaceRootEl(), widgetId);
        setInputOwner(createWidgetInputOwner(widgetId, 'activation'));
      });
    };

    props.onApiReady?.({
      ensureWidget: (type, options) => model.widgetActions.ensureWidget(type, options) ?? null,
      createWidget: (type, options) => {
        const center = viewportWorldCenter();
        const widget = model.widgetActions.addWidgetAtCursor(
          type,
          options?.worldX ?? center.worldX,
          options?.worldY ?? center.worldY,
        ) ?? null;
        if (widget && options?.centerViewport !== false) {
          model.navigation.centerOnWidget(widget);
        }
        return widget;
      },
      focusWidget: (widget, options) => {
        const focusedWidget = model.navigation.focusWidget(widget, options);
        focusWidgetRoot(focusedWidget.id);
        return focusedWidget;
      },
      fitWidget: (widget) => {
        const focusedWidget = model.navigation.fitWidget(widget);
        focusWidgetRoot(focusedWidget.id);
        return focusedWidget;
      },
      unfocusWidget: (widget) => {
        const focusedWidget = model.navigation.overviewWidget(widget);
        focusWidgetRoot(focusedWidget.id);
        return focusedWidget;
      },
      clearSelection: () => {
        model.selection.clear();
      },
      findWidgetByType: (type) => model.queries.findWidgetByType(type),
      findWidgetById: (widgetId) => model.queries.findWidgetById(widgetId),
      updateWidgetTitle: (widgetId, title) => {
        const normalizedWidgetId = String(widgetId ?? '').trim();
        const normalizedTitle = String(title ?? '').trim();
        if (!normalizedWidgetId || !normalizedTitle) {
          return;
        }

        props.setState((previous) => ({
          ...previous,
          widgets: previous.widgets.map((widget) =>
            widget.id === normalizedWidgetId && widget.title !== normalizedTitle
              ? { ...widget, title: normalizedTitle }
              : widget
          ),
        }));
      },
    });

    onCleanup(() => {
      props.onApiReady?.(null);
    });
  });

  const lockShortcut = () =>
    props.lockShortcut === undefined ? DEFAULT_LOCK_SHORTCUT : props.lockShortcut;

  const focusWidgetForViewport = (widget: WorkbenchWidgetItem) => {
    const focusedWidget = model.navigation.fitWidget(widget);
    queueMicrotask(() => {
      focusWorkbenchWidgetElement(surfaceRootEl(), focusedWidget.id);
      setInputOwner(createWidgetInputOwner(focusedWidget.id, 'activation'));
    });
  };

  const overviewWidgetForViewport = (widget: WorkbenchWidgetItem) => {
    const focusedWidget = model.navigation.overviewWidget(widget);
    queueMicrotask(() => {
      focusWorkbenchWidgetElement(surfaceRootEl(), focusedWidget.id);
      setInputOwner(createWidgetInputOwner(focusedWidget.id, 'activation'));
    });
  };

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

  createEffect(() => {
    if (typeof window === 'undefined') return;
    if (!model.contextMenu.state()) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (isWorkbenchContextMenuEvent(event)) return;
      model.contextMenu.close();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      model.contextMenu.close();
    };

    const handleViewportChange = () => {
      model.contextMenu.close();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    onCleanup(() => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
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
          model.navigation.handleArrowNavigation('up');
          break;
        case 'ArrowDown':
          event.preventDefault();
          model.navigation.handleArrowNavigation('down');
          break;
        case 'ArrowLeft':
          event.preventDefault();
          model.navigation.handleArrowNavigation('left');
          break;
        case 'ArrowRight':
          event.preventDefault();
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
    const frameEl = surfaceRootEl()?.querySelector(
      '[data-floe-workbench-canvas-frame="true"]'
    ) as HTMLElement | null;
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
      class={`workbench-surface redeven-workbench-surface${props.class ? ` ${props.class}` : ''}`}
      {...{ [REDEVEN_WORKBENCH_SURFACE_ROOT_ATTR]: 'true' }}
      data-redeven-workbench-tone={props.appearance?.tone ?? 'mist'}
      data-redeven-workbench-texture={props.appearance?.texture ?? 'grid'}
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
          onCanvasPointerDown={model.selection.clear}
          onSelectWidget={model.canvas.selectWidget}
          onFitWidget={focusWidgetForViewport}
          onOverviewWidget={overviewWidgetForViewport}
          onWidgetContextMenu={model.canvas.openWidgetContextMenu}
          onStartOptimisticFront={model.canvas.startOptimisticFront}
          onCommitFront={model.canvas.commitFront}
          onCommitMove={model.canvas.commitMove}
          onCommitResize={model.canvas.commitResize}
          onRequestDelete={props.onRequestDelete ?? model.widgetActions.deleteWidget}
          onLayoutInteractionStart={props.onLayoutInteractionStart}
          onLayoutInteractionEnd={props.onLayoutInteractionEnd}
        />
      </div>

      <RedevenWorkbenchLockButton
        locked={model.locked()}
        onToggle={model.lock.toggle}
        shortcutLabel={lockShortcut() ?? undefined}
      />

      <RedevenWorkbenchFilterBar
        widgetDefinitions={filterBarWidgetDefinitions()}
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
        appearance={props.appearance}
        onToneSelect={props.onToneSelect}
        onTextureSelect={props.onTextureSelect}
        onResetAppearance={props.onResetAppearance}
      />

      <Show when={model.contextMenu.state()}>
        <Portal>
          <div
            class="workbench-menu-backdrop"
            data-floe-workbench-boundary="true"
            onContextMenu={model.contextMenu.retarget}
          />
          <WorkbenchContextMenu
            x={model.contextMenu.position()?.left ?? 0}
            y={model.contextMenu.position()?.top ?? 0}
            items={contextMenuItems()}
          />
        </Portal>
      </Show>
    </div>
  );
}
