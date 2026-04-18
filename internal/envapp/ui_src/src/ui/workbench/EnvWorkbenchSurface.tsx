import { Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { isTypingElement } from '@floegence/floe-webapp-core';
import type {
  EnvWorkbenchState,
  EnvWorkbenchWidgetDefinition,
  EnvWorkbenchWidgetItem,
  EnvWorkbenchWidgetType,
} from './types';
import { EnvWorkbenchCanvas } from './EnvWorkbenchCanvas';
import { EnvWorkbenchContextMenu } from './EnvWorkbenchContextMenu';
import { EnvWorkbenchFilterBar } from './EnvWorkbenchFilterBar';
import { EnvWorkbenchHud } from './EnvWorkbenchHud';
import { EnvWorkbenchLockButton } from './EnvWorkbenchLockButton';
import { useEnvWorkbenchModel, type UseEnvWorkbenchModelOptions } from './useEnvWorkbenchModel';

export interface EnvWorkbenchSurfaceApi {
  ensureWidget: (
    type: EnvWorkbenchWidgetType,
    options?: { centerViewport?: boolean; worldX?: number; worldY?: number },
  ) => EnvWorkbenchWidgetItem | null;
  focusWidget: (widget: EnvWorkbenchWidgetItem, options?: { centerViewport?: boolean }) => EnvWorkbenchWidgetItem;
  findWidgetByType: (type: EnvWorkbenchWidgetType) => EnvWorkbenchWidgetItem | null;
}

export interface EnvWorkbenchSurfaceProps {
  state: () => EnvWorkbenchState;
  setState: (updater: (prev: EnvWorkbenchState) => EnvWorkbenchState) => void;
  widgetDefinitions?: readonly EnvWorkbenchWidgetDefinition[];
  lockShortcut?: string | null;
  enableKeyboard?: boolean;
  class?: string;
  onApiReady?: (api: EnvWorkbenchSurfaceApi | null) => void;
}

const DEFAULT_LOCK_SHORTCUT = 'F1';

export function EnvWorkbenchSurface(props: EnvWorkbenchSurfaceProps) {
  const modelOptions: UseEnvWorkbenchModelOptions = {
    state: () => props.state(),
    setState: (updater) => props.setState(updater),
    widgetDefinitions: props.widgetDefinitions,
  };

  const model = useEnvWorkbenchModel(modelOptions);

  createEffect(() => {
    props.onApiReady?.({
      ensureWidget: (type, options) => model.widgetActions.ensureWidget(type, options) ?? null,
      focusWidget: (widget, options) => model.navigation.focusWidget(widget, options),
      findWidgetByType: (type) => model.widgets().find((widget) => widget.type === type) ?? null,
    });

    onCleanup(() => {
      props.onApiReady?.(null);
    });
  });

  const lockShortcut = () => (props.lockShortcut === undefined ? DEFAULT_LOCK_SHORTCUT : props.lockShortcut);

  createEffect(() => {
    if (props.enableKeyboard === false || typeof document === 'undefined') {
      return;
    }

    const shortcut = lockShortcut();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (shortcut !== null && event.key === shortcut) {
        event.preventDefault();
        model.lock.toggle();
        return;
      }

      const target = event.target;
      if (target instanceof Element && isTypingElement(target)) {
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

  const handleCreateAtClient = (type: EnvWorkbenchWidgetType, clientX: number, clientY: number) => {
    const frameEl = document.querySelector('[data-redeven-workbench-canvas-frame="true"]') as HTMLElement | null;
    if (!frameEl) {
      return;
    }

    const rect = frameEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return;
    }

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const vp = model.viewport();
    const worldX = (localX - vp.x) / vp.scale;
    const worldY = (localY - vp.y) / vp.scale;
    model.widgetActions.ensureWidget(type, { centerViewport: true, worldX, worldY });
  };

  return (
    <div class={`workbench-surface${props.class ? ` ${props.class}` : ''}`}>
      <div class="workbench-surface__body" data-redeven-workbench-canvas-frame="true">
        <EnvWorkbenchCanvas
          widgetDefinitions={model.widgetDefinitions()}
          widgets={model.widgets()}
          viewport={model.viewport()}
          selectedWidgetId={model.selectedWidgetId()}
          optimisticFrontWidgetId={model.optimisticFrontWidgetId()}
          topZIndex={model.topZIndex()}
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

      <EnvWorkbenchLockButton
        locked={model.locked()}
        onToggle={model.lock.toggle}
        shortcutLabel={lockShortcut() ?? undefined}
      />

      <EnvWorkbenchFilterBar
        widgetDefinitions={model.widgetDefinitions()}
        widgets={model.widgets()}
        filters={model.filters()}
        onSoloFilter={model.filter.solo}
        onShowAll={model.filter.showAll}
        onCreateAt={handleCreateAtClient}
      />

      <EnvWorkbenchHud
        scaleLabel={model.scaleLabel()}
        onZoomOut={model.hud.zoomOut}
        onZoomIn={model.hud.zoomIn}
      />

      <Show when={model.contextMenu.state()}>
        <Portal>
          <div
            class="workbench-menu-backdrop"
            data-redeven-workbench-boundary="true"
            onClick={model.contextMenu.close}
            onContextMenu={model.contextMenu.retarget}
          />
          <EnvWorkbenchContextMenu
            x={model.contextMenu.position()?.left ?? 0}
            y={model.contextMenu.position()?.top ?? 0}
            items={model.contextMenu.items()}
          />
        </Portal>
      </Show>
    </div>
  );
}
