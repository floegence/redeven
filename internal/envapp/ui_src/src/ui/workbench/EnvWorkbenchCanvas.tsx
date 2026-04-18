import { For } from 'solid-js';
import { InfiniteCanvas, type InfiniteCanvasContextMenuEvent } from '@floegence/floe-webapp-core/ui';
import type {
  EnvWorkbenchViewport,
  EnvWorkbenchWidgetDefinition,
  EnvWorkbenchWidgetItem,
  EnvWorkbenchWidgetType,
} from './types';
import { EnvWorkbenchWidget } from './EnvWorkbenchWidget';
import { getEnvWorkbenchWidgetEntry } from './widgetRegistry';

export interface EnvWorkbenchCanvasProps {
  widgetDefinitions: readonly EnvWorkbenchWidgetDefinition[];
  widgets: readonly EnvWorkbenchWidgetItem[];
  viewport: EnvWorkbenchViewport;
  selectedWidgetId: string | null;
  optimisticFrontWidgetId: string | null;
  topZIndex: number;
  locked: boolean;
  filters: Record<EnvWorkbenchWidgetType, boolean>;
  setCanvasFrameRef: (element: HTMLDivElement | undefined) => void;
  onViewportCommit: (viewport: EnvWorkbenchViewport) => void;
  onCanvasContextMenu: (event: InfiniteCanvasContextMenuEvent) => void;
  onSelectWidget: (widgetId: string) => void;
  onWidgetContextMenu: (event: MouseEvent, item: EnvWorkbenchWidgetItem) => void;
  onStartOptimisticFront: (widgetId: string) => void;
  onCommitFront: (widgetId: string) => void;
  onCommitMove: (widgetId: string, position: { x: number; y: number }) => void;
  onCommitResize: (widgetId: string, size: { width: number; height: number }) => void;
  onRequestDelete: (widgetId: string) => void;
}

export function EnvWorkbenchCanvas(props: EnvWorkbenchCanvasProps) {
  const lockedInteractiveSelector = '.workbench-canvas__field';

  return (
    <div class="workbench-canvas" classList={{ 'is-locked': props.locked }} ref={props.setCanvasFrameRef}>
      <InfiniteCanvas
        ariaLabel="Redeven workbench canvas"
        class="workbench-canvas__infinite"
        viewport={props.viewport}
        onViewportChange={props.onViewportCommit}
        onCanvasContextMenu={props.locked ? undefined : props.onCanvasContextMenu}
        interactiveSelector={props.locked ? lockedInteractiveSelector : undefined}
        minScale={props.locked ? props.viewport.scale : undefined}
        maxScale={props.locked ? props.viewport.scale : undefined}
      >
        <div class="workbench-canvas__field">
          <div class="workbench-canvas__grid" aria-hidden="true" />
          <For each={props.widgets}>
            {(item) => (
              <EnvWorkbenchWidget
                definition={getEnvWorkbenchWidgetEntry(item.type, props.widgetDefinitions)}
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
      </InfiniteCanvas>
    </div>
  );
}
