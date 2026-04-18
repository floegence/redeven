import { For } from 'solid-js';
import {
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
  topZIndex: number;
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

export function RedevenWorkbenchCanvas(props: RedevenWorkbenchCanvasProps) {
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
      >
        <div class="workbench-canvas__field">
          <div class="workbench-canvas__grid" aria-hidden="true" />
          <For each={props.widgets}>
            {(item) => (
              <RedevenWorkbenchWidget
                definition={getWidgetEntry(item.type, props.widgetDefinitions)}
                item={item}
                selected={props.selectedWidgetId === item.id}
                optimisticFront={props.optimisticFrontWidgetId === item.id}
                topZIndex={props.topZIndex}
                viewportScale={props.viewport.scale}
                locked={props.locked}
                filtered={!props.filters[item.type]}
                onSelect={props.onSelectWidget}
                onContextMenu={props.onWidgetContextMenu}
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
