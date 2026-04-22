import {
  WorkbenchSurface,
  type WorkbenchSurfaceApi,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
  type WorkbenchWidgetItem,
  type WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { redevenWorkbenchInteractionAdapter } from './workbenchInputRouting';

export interface RedevenWorkbenchSurfaceApi extends WorkbenchSurfaceApi {
  unfocusWidget: (widget: WorkbenchWidgetItem) => WorkbenchWidgetItem;
}

export interface RedevenWorkbenchSurfaceProps {
  state: () => WorkbenchState;
  setState: (updater: (prev: WorkbenchState) => WorkbenchState) => void;
  lockShortcut?: string | null;
  enableKeyboard?: boolean;
  class?: string;
  widgetDefinitions?: readonly WorkbenchWidgetDefinition[];
  filterBarWidgetTypes?: readonly WorkbenchWidgetType[];
  onApiReady?: (api: RedevenWorkbenchSurfaceApi | null) => void;
  onRequestDelete?: (widgetId: string) => void;
  onLayoutInteractionStart?: () => void;
  onLayoutInteractionEnd?: () => void;
}

function createRedevenWorkbenchSurfaceApi(api: WorkbenchSurfaceApi): RedevenWorkbenchSurfaceApi {
  return {
    ...api,
    unfocusWidget: (widget) => api.overviewWidget(widget),
  };
}

export function RedevenWorkbenchSurface(props: RedevenWorkbenchSurfaceProps) {
  return (
    <WorkbenchSurface
      state={props.state}
      setState={props.setState}
      lockShortcut={props.lockShortcut}
      enableKeyboard={props.enableKeyboard}
      class={props.class}
      widgetDefinitions={props.widgetDefinitions}
      launcherWidgetTypes={props.filterBarWidgetTypes}
      interactionAdapter={redevenWorkbenchInteractionAdapter}
      onApiReady={(api) => props.onApiReady?.(api ? createRedevenWorkbenchSurfaceApi(api) : null)}
      onRequestDelete={props.onRequestDelete}
      onLayoutInteractionStart={props.onLayoutInteractionStart}
      onLayoutInteractionEnd={props.onLayoutInteractionEnd}
    />
  );
}
