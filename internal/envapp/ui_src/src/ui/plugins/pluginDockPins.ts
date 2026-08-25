import {
  readRendererScopedUIStorageJSON,
  writeRendererScopedUIStorageJSON,
} from '../services/uiStorage';

const PLUGIN_PLACEMENT_PINS_SCHEMA_VERSION = 2;
const PLUGIN_PLACEMENT_PINS_KEY_PREFIX = 'redeven.plugin-dock-pins';

export type PluginPinPlacement = 'activity' | 'workbench';

export type PluginPlacementPins = Readonly<{
  activityInventoryKeys: readonly string[];
  workbenchInventoryKeys: readonly string[];
}>;

type PersistedPluginPlacementPinsV1 = Readonly<{
  schemaVersion: 1;
  inventoryKeys: readonly string[];
}>;

type PersistedPluginPlacementPinsV2 = Readonly<{
  schemaVersion: 2;
  activityInventoryKeys: readonly string[];
  workbenchInventoryKeys: readonly string[];
}>;

const EMPTY_PLUGIN_PLACEMENT_PINS: PluginPlacementPins = {
  activityInventoryKeys: [],
  workbenchInventoryKeys: [],
};

function normalizePins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const pins: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '' || pins.includes(entry)) continue;
    pins.push(entry);
  }
  return pins;
}

function normalizePlacementPins(value: PluginPlacementPins): PersistedPluginPlacementPinsV2 {
  return {
    schemaVersion: PLUGIN_PLACEMENT_PINS_SCHEMA_VERSION,
    activityInventoryKeys: normalizePins(value.activityInventoryKeys),
    workbenchInventoryKeys: normalizePins(value.workbenchInventoryKeys),
  };
}

export function pluginDockPinsStorageKey(environmentID: string): string {
  const scope = String(environmentID ?? '').trim();
  return `${PLUGIN_PLACEMENT_PINS_KEY_PREFIX}:${scope || 'default'}`;
}

export function loadPluginPlacementPins(key: string): PluginPlacementPins {
  const persisted = readRendererScopedUIStorageJSON<Partial<
    PersistedPluginPlacementPinsV1 | PersistedPluginPlacementPinsV2
  > | null>(key, null);
  if (!persisted || typeof persisted !== 'object') return EMPTY_PLUGIN_PLACEMENT_PINS;

  if (persisted.schemaVersion === 1) {
    const migrated = normalizePlacementPins({
      activityInventoryKeys: [],
      workbenchInventoryKeys: normalizePins((persisted as Partial<PersistedPluginPlacementPinsV1>).inventoryKeys),
    });
    writeRendererScopedUIStorageJSON(key, migrated);
    return {
      activityInventoryKeys: migrated.activityInventoryKeys,
      workbenchInventoryKeys: migrated.workbenchInventoryKeys,
    };
  }
  if (persisted.schemaVersion !== PLUGIN_PLACEMENT_PINS_SCHEMA_VERSION) {
    return EMPTY_PLUGIN_PLACEMENT_PINS;
  }

  const current = persisted as Partial<PersistedPluginPlacementPinsV2>;
  return {
    activityInventoryKeys: normalizePins(current.activityInventoryKeys),
    workbenchInventoryKeys: normalizePins(current.workbenchInventoryKeys),
  };
}

export function savePluginPlacementPins(key: string, pins: PluginPlacementPins): void {
  writeRendererScopedUIStorageJSON(key, normalizePlacementPins(pins));
}

export function hasPluginPlacementPin(
  pins: PluginPlacementPins,
  placement: PluginPinPlacement,
  inventoryKey: string,
): boolean {
  const candidate = String(inventoryKey ?? '').trim();
  if (!candidate) return false;
  return (placement === 'activity' ? pins.activityInventoryKeys : pins.workbenchInventoryKeys)
    .includes(candidate);
}

export function setPluginPlacementPin(
  pins: PluginPlacementPins,
  placement: PluginPinPlacement,
  inventoryKey: string,
  pinned: boolean,
): PluginPlacementPins {
  const activityInventoryKeys = normalizePins(pins.activityInventoryKeys);
  const workbenchInventoryKeys = normalizePins(pins.workbenchInventoryKeys);
  const current = placement === 'activity' ? activityInventoryKeys : workbenchInventoryKeys;
  const candidate = String(inventoryKey ?? '').trim();
  const next = candidate === ''
    ? current
    : pinned
      ? (current.includes(candidate) ? current : [...current, candidate])
      : current.filter((entry) => entry !== candidate);
  return placement === 'activity'
    ? { activityInventoryKeys: next, workbenchInventoryKeys }
    : { activityInventoryKeys, workbenchInventoryKeys: next };
}
