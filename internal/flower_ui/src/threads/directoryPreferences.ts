export type FlowerDirectoryPreferences = Readonly<{ mode: 'time' | 'directory'; order: readonly string[] }>;

const DEFAULT_PREFERENCES: FlowerDirectoryPreferences = { mode: 'time', order: [] };

function storageKey(scope: string): string {
  return `redeven.flower.directoryList.${encodeURIComponent(scope)}`;
}

export function loadFlowerDirectoryPreferences(scope: string): FlowerDirectoryPreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(scope)) ?? 'null');
    if (!value || typeof value !== 'object') return DEFAULT_PREFERENCES;
    const preferences = value as { mode?: unknown; order?: unknown };
    return {
      mode: preferences.mode === 'directory' ? 'directory' : 'time',
      order: Array.isArray(preferences.order) ? preferences.order.filter((path): path is string => typeof path === 'string') : [],
    };
  } catch { return DEFAULT_PREFERENCES; }
}

export function saveFlowerDirectoryPreferences(scope: string, preferences: FlowerDirectoryPreferences): void {
  try { window.localStorage.setItem(storageKey(scope), JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
}
