import { createContext, useContext, type Accessor } from 'solid-js';

import type { PluginConfirmationQueue } from '../plugins/PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from '../plugins/pluginPlatform';
import type { PluginSurfaceLaunchTarget } from '../plugins/pluginTypes';

export type WorkbenchPluginSurfaceController = Readonly<{
  open: (target: PluginSurfaceLaunchTarget) => Promise<void>;
  close: (target: Pick<PluginSurfaceLaunchTarget, 'pluginInstanceID' | 'surfaceID'>) => Promise<void>;
  closePlugin: (pluginInstanceID: string) => Promise<void>;
  closeAll: () => Promise<void>;
  listPluginTargets: (pluginInstanceID: string) => readonly PluginSurfaceLaunchTarget[];
}>;

export type WorkbenchPluginSurfaceContextValue = Readonly<{
  coordinator: PluginSurfacePlacementCoordinator;
  confirmationQueue: PluginConfirmationQueue;
  workbenchVisible: Accessor<boolean>;
  resolveTarget: (target: PluginSurfaceLaunchTarget) => PluginSurfaceLaunchTarget | null;
  onRetirementError: (error: unknown) => void;
}>;

export const WorkbenchPluginSurfaceContext = createContext<WorkbenchPluginSurfaceContextValue>();

export function useWorkbenchPluginSurfaceContext(): WorkbenchPluginSurfaceContextValue | undefined {
  return useContext(WorkbenchPluginSurfaceContext);
}
