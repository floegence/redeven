import { createMemo, createSignal } from 'solid-js';
import type { InfiniteCanvasContextMenuEvent } from '@floegence/floe-webapp-core/ui';
import { ArrowUp, Copy, Trash } from '@floegence/floe-webapp-core/icons';
import type { EnvWorkbenchContextMenuItem } from './EnvWorkbenchContextMenu';
import {
  clampEnvWorkbenchScale,
  createEnvWorkbenchContextMenuPosition,
  createEnvWorkbenchId,
  ENV_WORKBENCH_CANVAS_ZOOM_STEP,
  ENV_WORKBENCH_CONTEXT_MENU_WIDTH_PX,
  estimateEnvWorkbenchContextMenuHeight,
  findNearestEnvWorkbenchWidget,
  getEnvWorkbenchTopZIndex,
} from './helpers';
import type {
  EnvWorkbenchContextMenuState,
  EnvWorkbenchState,
  EnvWorkbenchViewport,
  EnvWorkbenchWidgetDefinition,
  EnvWorkbenchWidgetItem,
  EnvWorkbenchWidgetType,
} from './types';
import {
  createEnvWorkbenchFilterState,
  getEnvWorkbenchWidgetEntry,
  resolveEnvWorkbenchWidgetDefinitions,
} from './widgetRegistry';

export interface UseEnvWorkbenchModelOptions {
  state: () => EnvWorkbenchState;
  setState: (updater: (prev: EnvWorkbenchState) => EnvWorkbenchState) => void;
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[];
}

export function useEnvWorkbenchModel(options: UseEnvWorkbenchModelOptions) {
  const [contextMenu, setContextMenu] = createSignal<EnvWorkbenchContextMenuState | null>(null);
  const [optimisticFrontWidgetId, setOptimisticFrontWidgetId] = createSignal<string | null>(null);
  const [canvasFrameSize, setCanvasFrameSize] = createSignal({ width: 0, height: 0 });

  const state = options.state;
  const widgets = createMemo(() => state().widgets);
  const viewport = createMemo(() => state().viewport);
  const locked = createMemo(() => state().locked);
  const filters = createMemo(() => state().filters);
  const selectedWidgetId = createMemo(() => state().selectedWidgetId);
  const topZIndex = createMemo(() => getEnvWorkbenchTopZIndex(widgets()));
  const scaleLabel = createMemo(() => `${Math.round(viewport().scale * 100)}%`);
  const widgetDefinitions = createMemo(() => resolveEnvWorkbenchWidgetDefinitions(options.widgetDefinitions));

  const setCanvasFrameRef = (element: HTMLDivElement | undefined) => {
    if (element) {
      setCanvasFrameSize({ width: element.clientWidth, height: element.clientHeight });
    }
  };

  const openCanvasContextMenu = (event: InfiniteCanvasContextMenuEvent) => {
    setContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: event.worldX,
      worldY: event.worldY,
    });
  };

  const openWidgetContextMenu = (event: MouseEvent, item: EnvWorkbenchWidgetItem) => {
    commitFront(item.id);
    setContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: item.x,
      worldY: item.y,
      widgetId: item.id,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const findWidgetById = (widgetId: string) => widgets().find((widget) => widget.id === widgetId) ?? null;

  const findWidgetByType = (type: EnvWorkbenchWidgetType) => widgets().find((widget) => widget.type === type) ?? null;

  const selectWidget = (widgetId: string) => {
    options.setState((prev) => ({ ...prev, selectedWidgetId: widgetId }));
  };

  const commitFront = (widgetId: string) => {
    setOptimisticFrontWidgetId(widgetId);
    const top = topZIndex();
    const widget = findWidgetById(widgetId);
    if (widget && widget.z_index < top) {
      options.setState((prev) => ({
        ...prev,
        widgets: prev.widgets.map((entry) => (entry.id === widgetId ? { ...entry, z_index: top + 1 } : entry)),
      }));
    }
  };

  const startOptimisticFront = (widgetId: string) => {
    setOptimisticFrontWidgetId(widgetId);
  };

  const commitMove = (widgetId: string, position: { x: number; y: number }) => {
    options.setState((prev) => ({
      ...prev,
      widgets: prev.widgets.map((widget) => (widget.id === widgetId ? { ...widget, x: position.x, y: position.y } : widget)),
    }));
  };

  const commitResize = (widgetId: string, size: { width: number; height: number }) => {
    options.setState((prev) => ({
      ...prev,
      widgets: prev.widgets.map((widget) => (widget.id === widgetId ? { ...widget, width: size.width, height: size.height } : widget)),
    }));
  };

  const commitViewport = (next: EnvWorkbenchViewport) => {
    options.setState((prev) => ({ ...prev, viewport: next }));
  };

  const viewportWorldCenter = () => {
    const frame = canvasFrameSize();
    const vp = viewport();
    return {
      worldX: frame.width > 0 ? (frame.width / 2 - vp.x) / vp.scale : 240,
      worldY: frame.height > 0 ? (frame.height / 2 - vp.y) / vp.scale : 180,
    };
  };

  const focusWidget = (widget: EnvWorkbenchWidgetItem, options?: { centerViewport?: boolean }) => {
    selectWidget(widget.id);
    commitFront(widget.id);
    if (options?.centerViewport !== false) {
      centerViewportOnWidget(widget);
    }
    return widget;
  };

  const addWidget = (type: EnvWorkbenchWidgetType, worldX: number, worldY: number) => {
    const entry = getEnvWorkbenchWidgetEntry(type, widgetDefinitions());
    const existing = entry.singleton ? findWidgetByType(type) : null;
    if (existing) {
      return focusWidget(existing, { centerViewport: true });
    }

    const dims = entry.defaultSize;
    const newWidget: EnvWorkbenchWidgetItem = {
      id: createEnvWorkbenchId(),
      type,
      title: entry.defaultTitle,
      x: worldX,
      y: worldY,
      width: dims.width,
      height: dims.height,
      z_index: topZIndex() + 1,
      created_at_unix_ms: Date.now(),
    };

    options.setState((prev) => ({
      ...prev,
      widgets: [...prev.widgets, newWidget],
      selectedWidgetId: newWidget.id,
    }));

    return newWidget;
  };

  const addWidgetAtCursor = (type: EnvWorkbenchWidgetType, worldX: number, worldY: number) => {
    const entry = getEnvWorkbenchWidgetEntry(type, widgetDefinitions());
    const dims = entry.defaultSize;
    return addWidget(type, worldX - dims.width / 2, worldY - dims.height / 2);
  };

  const ensureWidget = (
    type: EnvWorkbenchWidgetType,
    options?: { centerViewport?: boolean; worldX?: number; worldY?: number },
  ) => {
    const existing = findWidgetByType(type);
    if (existing) {
      return focusWidget(existing, { centerViewport: options?.centerViewport ?? true });
    }

    const center = viewportWorldCenter();
    const widget = addWidgetAtCursor(
      type,
      options?.worldX ?? center.worldX,
      options?.worldY ?? center.worldY,
    );
    if ((options?.centerViewport ?? true) && widget) {
      centerViewportOnWidget(widget);
    }
    return widget;
  };

  const deleteWidget = (widgetId: string) => {
    options.setState((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((widget) => widget.id !== widgetId),
      selectedWidgetId: prev.selectedWidgetId === widgetId ? null : prev.selectedWidgetId,
    }));
  };

  const adjustZoom = (direction: 'in' | 'out') => {
    const vp = viewport();
    const frame = canvasFrameSize();
    const centerWorldX = (frame.width / 2 - vp.x) / vp.scale;
    const centerWorldY = (frame.height / 2 - vp.y) / vp.scale;
    const nextScale = clampEnvWorkbenchScale(
      direction === 'in'
        ? vp.scale * ENV_WORKBENCH_CANVAS_ZOOM_STEP
        : vp.scale / ENV_WORKBENCH_CANVAS_ZOOM_STEP,
    );

    commitViewport({
      x: frame.width / 2 - centerWorldX * nextScale,
      y: frame.height / 2 - centerWorldY * nextScale,
      scale: nextScale,
    });
  };

  let navigationAnimToken = 0;

  const animateViewportTo = (targetX: number, targetY: number, targetScale: number) => {
    const vp = viewport();
    const startX = vp.x;
    const startY = vp.y;
    const startScale = vp.scale;
    const startTime = performance.now();
    const token = ++navigationAnimToken;
    const durationMs = 320;
    const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

    const tick = (now: number) => {
      if (token !== navigationAnimToken) {
        return;
      }

      const elapsed = now - startTime;
      const progress = Math.min(Math.max(elapsed / durationMs, 0), 1);
      const eased = easeOutCubic(progress);

      commitViewport({
        x: startX + (targetX - startX) * eased,
        y: startY + (targetY - startY) * eased,
        scale: startScale + (targetScale - startScale) * eased,
      });

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const centerViewportOnWidget = (widget: EnvWorkbenchWidgetItem) => {
    const frame = canvasFrameSize();
    if (frame.width === 0 || frame.height === 0) {
      return;
    }
    const vp = viewport();
    const targetX = frame.width / 2 - (widget.x + widget.width / 2) * vp.scale;
    const targetY = frame.height / 2 - (widget.y + widget.height / 2) * vp.scale;
    animateViewportTo(targetX, targetY, vp.scale);
  };

  const toggleLock = () => {
    options.setState((prev) => ({ ...prev, locked: !prev.locked }));
  };

  const soloFilter = (type: EnvWorkbenchWidgetType) => {
    options.setState((prev) => {
      const next: Record<EnvWorkbenchWidgetType, boolean> = {};
      widgetDefinitions().forEach((entry) => {
        next[entry.type] = entry.type === type;
      });
      return { ...prev, filters: next };
    });
  };

  const showAll = () => {
    options.setState((prev) => ({
      ...prev,
      filters: createEnvWorkbenchFilterState(widgetDefinitions()),
    }));
  };

  const handleArrowNavigation = (direction: 'up' | 'down' | 'left' | 'right') => {
    const target = findNearestEnvWorkbenchWidget(widgets(), selectedWidgetId(), direction, filters());
    if (target) {
      focusWidget(target, { centerViewport: true });
    }
  };

  const deleteSelected = () => {
    const widgetId = selectedWidgetId();
    if (widgetId) {
      deleteWidget(widgetId);
    }
  };

  const contextMenuItems = createMemo<EnvWorkbenchContextMenuItem[]>(() => {
    const menu = contextMenu();
    if (!menu) {
      return [];
    }

    if (menu.widgetId) {
      const widget = findWidgetById(menu.widgetId);
      const items: EnvWorkbenchContextMenuItem[] = [];

      if (widget) {
        items.push({
          id: 'bring-to-front',
          kind: 'action',
          label: 'Bring to front',
          icon: ArrowUp,
          onSelect: () => {
            focusWidget(widget, { centerViewport: false });
            closeContextMenu();
          },
        });

        const entry = getEnvWorkbenchWidgetEntry(widget.type, widgetDefinitions());
        if (!entry.singleton) {
          items.push({
            id: 'duplicate',
            kind: 'action',
            label: 'Duplicate',
            icon: Copy,
            onSelect: () => {
              addWidget(widget.type, widget.x + 32, widget.y + 32);
              closeContextMenu();
            },
          });
        }
      }

      items.push({ id: 'separator-delete', kind: 'separator' });
      items.push({
        id: 'delete',
        kind: 'action',
        label: 'Remove',
        icon: Trash,
        destructive: true,
        onSelect: () => {
          if (menu.widgetId) {
            deleteWidget(menu.widgetId);
          }
          closeContextMenu();
        },
      });

      return items;
    }

    return widgetDefinitions().map((entry) => {
      const existing = findWidgetByType(entry.type);
      return {
        id: `open-${entry.type}`,
        kind: 'action' as const,
        label: existing && entry.singleton ? `Reveal ${entry.label}` : `Add ${entry.label}`,
        icon: entry.icon,
        onSelect: () => {
          ensureWidget(entry.type, {
            centerViewport: Boolean(existing) || true,
            worldX: menu.worldX,
            worldY: menu.worldY,
          });
          closeContextMenu();
        },
      };
    });
  });

  const contextMenuPosition = createMemo(() => {
    const menu = contextMenu();
    if (!menu) {
      return undefined;
    }

    const items = contextMenuItems();
    const actionCount = items.filter((item) => item.kind === 'action').length;
    const separatorCount = items.filter((item) => item.kind === 'separator').length;

    return createEnvWorkbenchContextMenuPosition({
      clientX: menu.clientX,
      clientY: menu.clientY,
      menuWidth: ENV_WORKBENCH_CONTEXT_MENU_WIDTH_PX,
      menuHeight: estimateEnvWorkbenchContextMenuHeight(actionCount, separatorCount),
    });
  });

  return {
    widgetDefinitions,
    widgets,
    viewport,
    locked,
    filters,
    selectedWidgetId,
    topZIndex,
    scaleLabel,
    optimisticFrontWidgetId,
    setCanvasFrameRef,

    contextMenu: {
      state: contextMenu,
      items: contextMenuItems,
      position: contextMenuPosition,
      close: closeContextMenu,
      retarget: (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({
          clientX: event.clientX,
          clientY: event.clientY,
          worldX: 0,
          worldY: 0,
        });
      },
    },

    canvas: {
      openCanvasContextMenu,
      openWidgetContextMenu,
      selectWidget,
      startOptimisticFront,
      commitFront,
      commitMove,
      commitResize,
      commitViewport,
    },

    hud: {
      zoomIn: () => adjustZoom('in'),
      zoomOut: () => adjustZoom('out'),
    },

    lock: {
      toggle: toggleLock,
    },

    filter: {
      solo: soloFilter,
      showAll,
    },

    navigation: {
      handleArrowNavigation,
      centerOnWidget: centerViewportOnWidget,
      focusWidget,
    },

    widgetActions: {
      deleteSelected,
      deleteWidget,
      addWidget,
      addWidgetAtCursor,
      ensureWidget,
    },
  };
}
