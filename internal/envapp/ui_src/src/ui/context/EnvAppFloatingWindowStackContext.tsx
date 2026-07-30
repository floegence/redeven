import { createContext, useContext, type ParentProps } from 'solid-js';

import {
  createEnvAppFloatingWindowStack,
  type EnvAppFloatingWindowStack,
} from '../utils/envAppFloatingWindowStack';

const EnvAppFloatingWindowStackContext = createContext<EnvAppFloatingWindowStack>();

export function EnvAppFloatingWindowStackProvider(props: ParentProps) {
  const stack = createEnvAppFloatingWindowStack();
  return (
    <EnvAppFloatingWindowStackContext.Provider value={stack}>
      {props.children}
    </EnvAppFloatingWindowStackContext.Provider>
  );
}

export function useEnvAppFloatingWindowStack(): EnvAppFloatingWindowStack | undefined {
  return useContext(EnvAppFloatingWindowStackContext);
}
