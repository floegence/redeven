export const DEFAULT_ENVAPP_STORAGE_NAMESPACE = 'redeven-envapp';
export const DESKTOP_ENVAPP_STORAGE_NAMESPACE = 'redeven-envapp:desktop';
export const DEFAULT_WORKBENCH_LOCAL_PREFERENCES_KEY = 'workbench:local_preferences';
export const DESKTOP_WORKBENCH_LOCAL_PREFERENCES_KEY = 'workbench:local_preferences:desktop';
export const DEFAULT_WORKBENCH_INSTANCE_STATE_KEY = 'workbench:instance_state';
export const DESKTOP_WORKBENCH_INSTANCE_STATE_KEY = 'workbench:instance_state:desktop';

export interface EnvAppStorageBinding {
  namespace: string;
  workbenchLocalPreferencesKey: string;
  workbenchInstanceStateKey: string;
}

export interface ResolveEnvAppStorageBindingOptions {
  envID?: string | null;
  desktopStateStorageAvailable: boolean;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function resolveEnvAppStorageBinding(options: ResolveEnvAppStorageBindingOptions): EnvAppStorageBinding {
  if (options.desktopStateStorageAvailable) {
    return {
      namespace: DESKTOP_ENVAPP_STORAGE_NAMESPACE,
      workbenchLocalPreferencesKey: DESKTOP_WORKBENCH_LOCAL_PREFERENCES_KEY,
      workbenchInstanceStateKey: DESKTOP_WORKBENCH_INSTANCE_STATE_KEY,
    };
  }

  const envID = compact(options.envID);
  if (!envID) {
    return {
      namespace: DEFAULT_ENVAPP_STORAGE_NAMESPACE,
      workbenchLocalPreferencesKey: DEFAULT_WORKBENCH_LOCAL_PREFERENCES_KEY,
      workbenchInstanceStateKey: DEFAULT_WORKBENCH_INSTANCE_STATE_KEY,
    };
  }

  return {
    namespace: `${DEFAULT_ENVAPP_STORAGE_NAMESPACE}:${envID}`,
    workbenchLocalPreferencesKey: `${DEFAULT_WORKBENCH_LOCAL_PREFERENCES_KEY}:${envID}`,
    workbenchInstanceStateKey: `${DEFAULT_WORKBENCH_INSTANCE_STATE_KEY}:${envID}`,
  };
}
