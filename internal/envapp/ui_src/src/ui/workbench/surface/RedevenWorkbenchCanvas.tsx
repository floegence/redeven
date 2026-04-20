import { For, Show, createMemo } from 'solid-js';
import {
  createWorkbenchRenderLayerMap,
  getWidgetEntry,
  resolveWorkbenchWidgetRenderMode,
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
  canvasFrameSize: { width: number; height: number };
  selectedWidgetId: string | null;
  optimisticFrontWidgetId: string | null;
  locked: boolean;
  filters: Record<WorkbenchWidgetType, boolean>;
  setCanvasFrameRef: (el: HTMLDivElement | undefined) => void;
  onViewportCommit: (viewport: WorkbenchViewport) => void;
  onCanvasContextMenu: (event: InfiniteCanvasContextMenuEvent) => void;
  onSelectWidget: (widgetId: string) => void;
  onWidgetContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
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
  onWidgetContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
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
      onContextMenu={props.onWidgetContextMenu}
      onStartOptimisticFront={props.onStartOptimisticFront}
      onCommitFront={props.onCommitFront}
      onCommitMove={props.onCommitMove}
      onCommitResize={props.onCommitResize}
      onRequestDelete={props.onRequestDelete}
    />
  );
}

interface RedevenProjectedWidgetSlotProps {
  widgetId: string;
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
  widgetById: () => Map<string, WorkbenchWidgetItem>;
  renderLayers: () => ReturnType<typeof createWorkbenchRenderLayerMap>;
  selectedWidgetId: string | null;
  optimisticFrontWidgetId: string | null;
  locked: boolean;
  filters: Record<WorkbenchWidgetType, boolean>;
  projectedViewport: WorkbenchViewport;
  surfaceReady: boolean;
  onSelectWidget: (widgetId: string) => void;
  onWidgetContextMenu: (event: MouseEvent, item: WorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
}

function RedevenProjectedWidgetSlot(props: RedevenProjectedWidgetSlotProps) {
  const item = createMemo<WorkbenchWidgetItem>((previous) => {
    const current = props.widgetById().get(props.widgetId);
    if (current) return current;
    if (previous) return previous;
    throw new Error(`Redeven workbench widget ${props.widgetId} is missing from the projected render map.`);
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
      viewportScale={props.projectedViewport.scale}
      locked={props.locked}
      filtered={!props.filters[item().type]}
      layoutMode="projected_surface"
      projectedViewport={props.projectedViewport}
      surfaceReady={props.surfaceReady}
      onSelect={props.onSelectWidget}
      onContextMenu={props.onWidgetContextMenu}
      onStartOptimisticFront={props.onStartOptimisticFront}
      onCommitFront={props.onCommitFront}
      onCommitMove={props.onCommitMove}
      onCommitResize={props.onCommitResize}
      onRequestDelete={props.onRequestDelete}
    />
  );
}

export function RedevenWorkbenchCanvas(props: RedevenWorkbenchCanvasProps) {
  const widgetById = createMemo(() => new Map(props.widgets.map((item) => [item.id, item] as const)));
  const renderLayers = createMemo(() => createWorkbenchRenderLayerMap(props.widgets));
  const canvasWidgetIds = createMemo(() =>
    props.widgets
      .filter((item) => {
        const definition = getWidgetEntry(item.type, props.widgetDefinitions);
        return resolveWorkbenchWidgetRenderMode(definition) === 'canvas_scaled';
      })
      .map((item) => item.id)
  );
  const projectedWidgetIds = createMemo(() =>
    props.widgets
      .filter((item) => {
        const definition = getWidgetEntry(item.type, props.widgetDefinitions);
        return resolveWorkbenchWidgetRenderMode(definition) === 'projected_surface';
      })
      .map((item) => item.id)
  );
  const projectedSurfaceReady = () =>
    props.canvasFrameSize.width > 0 && props.canvasFrameSize.height > 0;

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
        disablePanZoom={props.locked}
        overlay={(liveViewport) => (
          <Show when={projectedWidgetIds().length > 0}>
            <div class="workbench-canvas__projected-layer">
              <For each={projectedWidgetIds()}>
                {(widgetId) => (
                  <RedevenProjectedWidgetSlot
                    widgetId={widgetId}
                    widgetDefinitions={props.widgetDefinitions}
                    widgetById={widgetById}
                    renderLayers={renderLayers}
                    selectedWidgetId={props.selectedWidgetId}
                    optimisticFrontWidgetId={props.optimisticFrontWidgetId}
                    locked={props.locked}
                    filters={props.filters}
                    onSelectWidget={props.onSelectWidget}
                    onWidgetContextMenu={props.onWidgetContextMenu}
                    onStartOptimisticFront={props.onStartOptimisticFront}
                    onCommitFront={props.onCommitFront}
                    onCommitMove={props.onCommitMove}
                    onCommitResize={props.onCommitResize}
                    onRequestDelete={props.onRequestDelete}
                    projectedViewport={liveViewport}
                    surfaceReady={projectedSurfaceReady()}
                  />
                )}
              </For>
            </div>
          </Show>
        )}
      >
        <div class="workbench-canvas__field">
          <div class="workbench-canvas__grid" aria-hidden="true" />
          {/* Preserve business widget ownership by widget.id so selection/front changes do not remount surface bodies. */}
          <For each={canvasWidgetIds()}>
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
                onWidgetContextMenu={props.onWidgetContextMenu}
                onStartOptimisticFront={props.onStartOptimisticFront}
                onCommitFront={props.onCommitFront}
                onCommitMove={props.onCommitMove}
                onCommitResize={props.onCommitResize}
                onRequestDelete={props.onRequestDelete}
              />
            )}
          </For>
        </div>
      </RedevenInfiniteCanvas>
    </div>
  );
}
