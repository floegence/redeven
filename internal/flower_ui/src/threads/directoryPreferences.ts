export type FlowerDirectoryPreferences = Readonly<{ mode: 'time' | 'directory'; order: readonly string[] }>;
export type FlowerDirectoryPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_PREFERENCES: FlowerDirectoryPreferences = { mode: 'time', order: [] };

function storageKey(scope: string): string {
  return `redeven.flower.directoryList.${encodeURIComponent(scope)}`;
}

export function loadFlowerDirectoryPreferences(scope: string, storage?: FlowerDirectoryPreferenceStorage): FlowerDirectoryPreferences {
  try {
    const key = storageKey(scope);
    const saved = (storage ?? window.localStorage).getItem(key);
    // Preserve a preference previously saved in this renderer when adopting
    // the host's durable storage. The host remains the owner after migration.
    const previous = saved === null && storage ? window.localStorage.getItem(key) : null;
    const value: unknown = JSON.parse(saved ?? previous ?? 'null');
    if (!value || typeof value !== 'object') return DEFAULT_PREFERENCES;
    const preferences = value as { mode?: unknown; order?: unknown };
    const result: FlowerDirectoryPreferences = {
      mode: preferences.mode === 'directory' ? 'directory' : 'time',
      order: Array.isArray(preferences.order) ? preferences.order.filter((path): path is string => typeof path === 'string') : [],
    };
    if (previous !== null) {
      try { storage?.setItem(key, JSON.stringify(result)); } catch { /* Keep the preference for this session. */ }
    }
    return result;
  } catch { return DEFAULT_PREFERENCES; }
}

export function saveFlowerDirectoryPreferences(scope: string, preferences: FlowerDirectoryPreferences, storage?: FlowerDirectoryPreferenceStorage): void {
  try { (storage ?? window.localStorage).setItem(storageKey(scope), JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
}
