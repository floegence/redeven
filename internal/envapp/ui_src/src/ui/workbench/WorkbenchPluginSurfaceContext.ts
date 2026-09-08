import { createContext, useContext, type Accessor } from 'solid-js';
import type { WorkbenchCanvasWidgetPlacement } from '@floegence/floe-webapp-core/workbench';

import type { PluginConfirmationQueue } from '../plugins/PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from '../plugins/pluginPlatform';
import type { PluginSurfaceLaunchTarget } from '../plugins/pluginTypes';
import type { PluginSurfaceResolver } from '../plugins/PluginSurfaceContainer';

export type WorkbenchPluginSurfaceController = Readonly<{
  open: (target: PluginSurfaceLaunchTarget, placement?: WorkbenchCanvasWidgetPlacement) => Promise<void>;
  releasePlugin: (pluginInstanceID: string) => Promise<void>;
  releaseAll: () => Promise<void>;
  focus: (target: PluginSurfaceLaunchTarget) => void;
}>;

export type WorkbenchPluginSurfaceContextValue = Readonly<{
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  workbenchVisible: Accessor<boolean>;
  resolveTarget: (target: PluginSurfaceLaunchTarget) => PluginSurfaceLaunchTarget | null;
  resolveSurface?: PluginSurfaceResolver;
  onOpenPluginDetails: (inventoryKey: string) => void;
  onRetirementError: (error: unknown) => void;
}>;

export const WorkbenchPluginSurfaceContext = createContext<WorkbenchPluginSurfaceContextValue>();

export function useWorkbenchPluginSurfaceContext(): WorkbenchPluginSurfaceContextValue | undefined {
  return useContext(WorkbenchPluginSurfaceContext);
}
