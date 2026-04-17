export const DEFAULT_ENVAPP_STORAGE_NAMESPACE = 'redeven-envapp';
export const DESKTOP_ENVAPP_STORAGE_NAMESPACE = 'redeven-envapp:desktop';
export const DEFAULT_DECK_STORAGE_KEY = 'deck';
export const DESKTOP_DECK_STORAGE_KEY = 'deck:desktop';
export const DEFAULT_WORKBENCH_STORAGE_KEY = 'workbench';
export const DESKTOP_WORKBENCH_STORAGE_KEY = 'workbench:desktop';

export interface EnvAppStorageBinding {
  namespace: string;
  deckStorageKey: string;
  workbenchStorageKey: string;
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
      deckStorageKey: DESKTOP_DECK_STORAGE_KEY,
      workbenchStorageKey: DESKTOP_WORKBENCH_STORAGE_KEY,
    };
  }

  const envID = compact(options.envID);
  if (!envID) {
    return {
      namespace: DEFAULT_ENVAPP_STORAGE_NAMESPACE,
      deckStorageKey: DEFAULT_DECK_STORAGE_KEY,
      workbenchStorageKey: DEFAULT_WORKBENCH_STORAGE_KEY,
    };
  }

  return {
    namespace: `${DEFAULT_ENVAPP_STORAGE_NAMESPACE}:${envID}`,
    deckStorageKey: `${DEFAULT_DECK_STORAGE_KEY}:${envID}`,
    workbenchStorageKey: `${DEFAULT_WORKBENCH_STORAGE_KEY}:${envID}`,
  };
}
