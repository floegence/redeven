import { createContext, useContext } from 'solid-js';

import type { AgentMaintenanceController } from './createAgentMaintenanceController';
import type { AgentVersionModel } from './createAgentVersionModel';

export type RuntimeUpdateContextValue = Readonly<{
  version: AgentVersionModel;
  maintenance: AgentMaintenanceController;
}>;

export const RuntimeUpdateContext = createContext<RuntimeUpdateContextValue>();

export function useRuntimeUpdateContext(): RuntimeUpdateContextValue {
  const context = useContext(RuntimeUpdateContext);
  if (!context) {
    throw new Error('RuntimeUpdateContext is missing');
  }
  return context;
}
