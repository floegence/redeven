import { createContext, useContext, type Accessor } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { WorkbenchWidgetType } from '@floegence/floe-webapp-core/workbench';
import type { TerminalCore, TerminalSessionInfo } from '@floegence/floeterm-terminal-web';

import type {
  RedevenWorkbenchTerminalGeometryPreferences,
  RedevenWorkbenchTerminalPanelState,
  WorkbenchOpenFileBrowserRequest,
  WorkbenchOpenFilePreviewRequest,
  WorkbenchOpenTerminalRequest,
} from './workbenchInstanceState';
import type { RuntimeWorkbenchPreviewItem } from './runtimeWorkbenchLayout';

export type EnvWorkbenchInstancesContextValue = Readonly<{
  latestWidgetIdByType: Accessor<Partial<Record<WorkbenchWidgetType, string>>>;
  markLatestWidget: (type: WorkbenchWidgetType, widgetId: string) => void;
  terminalPanelState: (widgetId: string) => RedevenWorkbenchTerminalPanelState;
  terminalGeometryPreferences: (widgetId: string) => RedevenWorkbenchTerminalGeometryPreferences;
  updateTerminalGeometryPreferences: (
    widgetId: string,
    updater: (
      previous: RedevenWorkbenchTerminalGeometryPreferences,
    ) => RedevenWorkbenchTerminalGeometryPreferences,
  ) => void;
  updateTerminalPanelState: (
    widgetId: string,
    updater: (
      previous: RedevenWorkbenchTerminalPanelState,
    ) => RedevenWorkbenchTerminalPanelState,
  ) => void;
  createTerminalSession: (widgetId: string, name: string | undefined, workingDir: string) => Promise<TerminalSessionInfo | null>;
  deleteTerminalSession: (widgetId: string, sessionId: string) => Promise<void>;
  registerTerminalCore: (widgetId: string, sessionId: string, core: TerminalCore | null) => void;
  registerTerminalSurface: (widgetId: string, sessionId: string, surface: HTMLDivElement | null) => void;
  terminalOpenRequest: (widgetId: string) => WorkbenchOpenTerminalRequest | null;
  dispatchTerminalOpenRequest: (request: WorkbenchOpenTerminalRequest) => void;
  consumeTerminalOpenRequest: (requestId: string) => void;
  fileBrowserOpenRequest: (widgetId: string) => WorkbenchOpenFileBrowserRequest | null;
  dispatchFileBrowserOpenRequest: (request: WorkbenchOpenFileBrowserRequest) => void;
  consumeFileBrowserOpenRequest: (requestId: string) => void;
  updateFileBrowserPath: (widgetId: string, path: string) => void;
  previewItem: (widgetId: string) => FileItem | null;
  pendingSyncedPreviewItem: (widgetId: string) => RuntimeWorkbenchPreviewItem | null;
  setPendingSyncedPreviewItem: (widgetId: string, item: RuntimeWorkbenchPreviewItem | null) => void;
  updatePreviewItem: (widgetId: string, item: FileItem | null) => void;
  previewOpenRequest: (widgetId: string) => WorkbenchOpenFilePreviewRequest | null;
  dispatchPreviewOpenRequest: (request: WorkbenchOpenFilePreviewRequest) => void;
  consumePreviewOpenRequest: (requestId: string) => void;
  registerWidgetRemoveGuard: (widgetId: string, guard: (() => boolean) | null) => void;
  removeWidget: (widgetId: string) => void;
  requestWidgetRemoval: (widgetId: string) => void;
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
