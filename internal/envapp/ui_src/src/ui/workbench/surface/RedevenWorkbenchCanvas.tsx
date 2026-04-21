import { For, createMemo } from 'solid-js';
import {
  createWorkbenchRenderLayerMap,
  getWidgetEntry,
  type WorkbenchViewport,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import {
  RedevenInfiniteCanvas,
  type InfiniteCanvasContextMenuEvent,
} from './RedevenInfiniteCanvas';
import { RedevenWorkbenchWidget } from './RedevenWorkbenchWidget';

export interface RedevenWorkbenchCanvasProps {
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  widgets: readonly WorkbenchWidgetItem[];
  viewport: WorkbenchViewport;
  selectedWidgetId: string | null;
  optimisticFrontWidgetId: string | null;
  locked: boolean;
  filters: Record<WorkbenchWidgetType, boolean>;
  setCanvasFrameRef: (el: HTMLDivElement | undefined) => void;
  onViewportCommit: (viewport: WorkbenchViewport) => void;
  onCanvasContextMenu: (event: InfiniteCanvasContextMenuEvent) => void;
  onCanvasPointerDown: (event: PointerEvent) => void;
  onSelectWidget: (widgetId: string) => void;
  onFitWidget: (widget: WorkbenchWidgetItem) => void;
  onOverviewWidget: (widget: WorkbenchWidgetItem) => void;
  onWidgetContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
}

interface RedevenWorkbenchCanvasWidgetSlotProps {
  widgetId: string;
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  widgetById: () => Map<string, WorkbenchWidgetItem>;
  renderLayers: () => ReturnType<typeof createWorkbenchRenderLayerMap>;
  selectedWidgetId: string | null;
  optimisticFrontWidgetId: string | null;
  viewportScale: number;
  locked: boolean;
  filters: Record<WorkbenchWidgetType, boolean>;
  onSelectWidget: (widgetId: string) => void;
  onFitWidget: (widget: WorkbenchWidgetItem) => void;
  onOverviewWidget: (widget: WorkbenchWidgetItem) => void;
  onWidgetContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
}

function RedevenWorkbenchCanvasWidgetSlot(props: RedevenWorkbenchCanvasWidgetSlotProps) {
  const item = createMemo<WorkbenchWidgetItem>((previous) => {
    const current = props.widgetById().get(props.widgetId);
    if (current) return current;
    if (previous) return previous;
    throw new Error(`Redeven workbench widget ${props.widgetId} is missing from the render map.`);
  });
  const definition = createMemo(() => getWidgetEntry(item().type, props.widgetDefinitions));

  return (
    <RedevenWorkbenchWidget
      definition={definition()}
      widgetId={props.widgetId}
      widgetTitle={item().title}
      widgetType={item().type}
      x={item().x}
      y={item().y}
      width={item().width}
      height={item().height}
      renderLayer={props.renderLayers().byWidgetId.get(props.widgetId) ?? 1}
      itemSnapshot={item}
      selected={props.selectedWidgetId === props.widgetId}
      optimisticFront={props.optimisticFrontWidgetId === props.widgetId}
      topRenderLayer={props.renderLayers().topRenderLayer}
      viewportScale={props.viewportScale}
      locked={props.locked}
      filtered={!props.filters[item().type]}
      onSelect={props.onSelectWidget}
      onFitWidget={() => props.onFitWidget(item())}
      onOverviewWidget={() => props.onOverviewWidget(item())}
      onContextMenu={props.onWidgetContextMenu}
      onStartOptimisticFront={props.onStartOptimisticFront}
      onCommitFront={props.onCommitFront}
      onCommitMove={props.onCommitMove}
      onCommitResize={props.onCommitResize}
      onRequestDelete={props.onRequestDelete}
      onLayoutInteractionStart={props.onLayoutInteractionStart}
      onLayoutInteractionEnd={props.onLayoutInteractionEnd}
    />
  );
}

export function RedevenWorkbenchCanvas(props: RedevenWorkbenchCanvasProps) {
  const widgetIds = createMemo(() => props.widgets.map((item) => item.id));
  const widgetById = createMemo(() => new Map(props.widgets.map((item) => [item.id, item] as const)));
  const renderLayers = createMemo(() => createWorkbenchRenderLayerMap(props.widgets));

  return (
    <div
      class="workbench-canvas"
      classList={{ 'is-locked': props.locked }}
      ref={props.setCanvasFrameRef}
    >
      <RedevenInfiniteCanvas
        ariaLabel="Workbench canvas"
        class="workbench-canvas__infinite"
        viewport={props.viewport}
        onViewportChange={props.onViewportCommit}
        onCanvasContextMenu={props.onCanvasContextMenu}
        onCanvasPointerDown={props.onCanvasPointerDown}
        selectedWidgetId={props.selectedWidgetId}
        disablePanZoom={props.locked}
      >
        <div class="workbench-canvas__field">
          <div class="workbench-canvas__grid" aria-hidden="true" />
          {/* Preserve business widget ownership by widget.id so selection/front changes do not remount surface bodies. */}
          <For each={widgetIds()}>
            {(widgetId) => (
              <RedevenWorkbenchCanvasWidgetSlot
                widgetId={widgetId}
                widgetDefinitions={props.widgetDefinitions}
                widgetById={widgetById}
                renderLayers={renderLayers}
                selectedWidgetId={props.selectedWidgetId}
                optimisticFrontWidgetId={props.optimisticFrontWidgetId}
                viewportScale={props.viewport.scale}
                locked={props.locked}
                filters={props.filters}
                onSelectWidget={props.onSelectWidget}
                onFitWidget={props.onFitWidget}
                onOverviewWidget={props.onOverviewWidget}
                onWidgetContextMenu={props.onWidgetContextMenu}
                onStartOptimisticFront={props.onStartOptimisticFront}
                onCommitFront={props.onCommitFront}
                onCommitMove={props.onCommitMove}
                onCommitResize={props.onCommitResize}
                onRequestDelete={props.onRequestDelete}
                onLayoutInteractionStart={props.onLayoutInteractionStart}
                onLayoutInteractionEnd={props.onLayoutInteractionEnd}
              />
            )}
          </For>
        </div>
      </RedevenInfiniteCanvas>
    </div>
  );
}
