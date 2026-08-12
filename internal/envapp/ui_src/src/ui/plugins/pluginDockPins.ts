import {
  readRendererScopedUIStorageJSON,
  writeRendererScopedUIStorageJSON,
} from '../services/uiStorage';

const PLUGIN_DOCK_PINS_SCHEMA_VERSION = 1;
const PLUGIN_DOCK_PINS_KEY_PREFIX = 'redeven.plugin-dock-pins';

type PersistedPluginDockPins = Readonly<{
  schemaVersion: number;
  inventoryKeys: readonly string[];
}>;

function normalizePins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const pins: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '' || pins.includes(entry)) continue;
    pins.push(entry);
  }
  return pins;
}

export function pluginDockPinsStorageKey(environmentID: string): string {
  const scope = String(environmentID ?? '').trim();
  return `${PLUGIN_DOCK_PINS_KEY_PREFIX}:${scope || 'default'}`;
}

export function loadPluginDockPins(key: string): string[] {
  const persisted = readRendererScopedUIStorageJSON<Partial<PersistedPluginDockPins> | null>(key, null);
  if (!persisted || persisted.schemaVersion !== PLUGIN_DOCK_PINS_SCHEMA_VERSION) return [];
  return normalizePins(persisted.inventoryKeys);
}

export function savePluginDockPins(key: string, inventoryKeys: readonly string[]): void {
  const value: PersistedPluginDockPins = {
    schemaVersion: PLUGIN_DOCK_PINS_SCHEMA_VERSION,
    inventoryKeys: normalizePins(inventoryKeys),
  };
  writeRendererScopedUIStorageJSON(key, value);
}

export function addPluginDockPin(inventoryKeys: readonly string[], inventoryKey: string): string[] {
  const normalized = normalizePins(inventoryKeys);
  const candidate = String(inventoryKey ?? '').trim();
  return candidate === '' || normalized.includes(candidate) ? normalized : [...normalized, candidate];
}
