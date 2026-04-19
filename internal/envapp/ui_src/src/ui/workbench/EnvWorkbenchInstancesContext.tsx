import { createContext, useContext, type Accessor } from 'solid-js';
import type { WorkbenchWidgetType } from '@floegence/floe-webapp-core/workbench';

import type {
  RedevenWorkbenchTerminalPanelState,
  WorkbenchOpenFileBrowserRequest,
  WorkbenchOpenTerminalRequest,
} from './workbenchInstanceState';

export type EnvWorkbenchInstancesContextValue = Readonly<{
  latestWidgetIdByType: Accessor<Partial<Record<WorkbenchWidgetType, string>>>;
  markLatestWidget: (type: WorkbenchWidgetType, widgetId: string) => void;
  terminalPanelState: (widgetId: string) => RedevenWorkbenchTerminalPanelState;
  updateTerminalPanelState: (
    widgetId: string,
    updater: (
      previous: RedevenWorkbenchTerminalPanelState,
    ) => RedevenWorkbenchTerminalPanelState,
  ) => void;
  terminalOpenRequest: (widgetId: string) => WorkbenchOpenTerminalRequest | null;
  dispatchTerminalOpenRequest: (request: WorkbenchOpenTerminalRequest) => void;
  consumeTerminalOpenRequest: (requestId: string) => void;
  fileBrowserOpenRequest: (widgetId: string) => WorkbenchOpenFileBrowserRequest | null;
  dispatchFileBrowserOpenRequest: (request: WorkbenchOpenFileBrowserRequest) => void;
  consumeFileBrowserOpenRequest: (requestId: string) => void;
  updateWidgetTitle: (widgetId: string, title: string) => void;
}>;

export const EnvWorkbenchInstancesContext = createContext<EnvWorkbenchInstancesContextValue>();

export function useEnvWorkbenchInstancesContext(): EnvWorkbenchInstancesContextValue {
  const ctx = useContext(EnvWorkbenchInstancesContext);
  if (!ctx) {
    throw new Error('EnvWorkbenchInstancesContext is missing');
  }
  return ctx;
}
