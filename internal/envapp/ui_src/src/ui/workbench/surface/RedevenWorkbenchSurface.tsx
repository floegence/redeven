import {
  WorkbenchSurface,
  type WorkbenchContextMenuItemsResolver,
  type WorkbenchSurfaceApi,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { redevenWorkbenchInteractionAdapter } from './workbenchInputRouting';
import {
  REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
  createWorkbenchOverviewViewport,
} from '../runtimeWorkbenchLayout';

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

export function RedevenWorkbenchSurface(props: RedevenWorkbenchSurfaceProps) {
  let hostRef: HTMLDivElement | undefined;

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
