import { createSignal } from 'solid-js';
import { isEnvSurfaceId, type EnvSurfaceId } from '../envViewMode';
import { isDesktopStateStorageAvailable, readUIStorageItem, readUIStorageJSON, removeUIStorageItem, rendererScopedUIStorageKey, writeUIStorageJSON } from './uiStorage';
import { resolveEnvAppStorageBinding } from './uiPersistence';

export type BuiltinActivityPage = EnvSurfaceId | 'settings' | 'plugin-center';
export type ActivityTarget = Readonly<{ kind: 'builtin'; page: BuiltinActivityPage }> | Readonly<{
  kind: 'plugin'; pluginInstanceID: string; pluginID: string; surfaceID: string;
}>;
export type ActivityNavigationRecord = Readonly<{
  version: 1; target: ActivityTarget; recentBuiltins: readonly BuiltinActivityPage[];
}>;
export const PENDING_ACTIVITY_PLUGIN_ID = 'redeven.activity-plugin-restore';
const LEGACY_PLUGIN_PREFIX = 'redeven.plugin.activity:';
export type ActivityRestoreTarget = ActivityTarget | Readonly<{ kind: 'legacy-plugin'; inventoryKey: string }>;

export function isBuiltinActivityPage(value: unknown): value is BuiltinActivityPage {
  return typeof value === 'string' && (isEnvSurfaceId(value) || value === 'settings' || value === 'plugin-center');
}

export function activityTargetID(target: ActivityRestoreTarget): string {
  return target.kind === 'builtin' ? target.page : PENDING_ACTIVITY_PLUGIN_ID;
}

function targetFromRecord(value: unknown): ActivityTarget | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Record<string, unknown>;
  if (target.kind === 'builtin' && isBuiltinActivityPage(target.page)) return { kind: 'builtin', page: target.page };
  if (target.kind === 'plugin' && ['pluginInstanceID', 'pluginID', 'surfaceID'].every(key => typeof target[key] === 'string' && target[key].trim() && target[key].length <= 512)) {
    return { kind: 'plugin', pluginInstanceID: target.pluginInstanceID as string, pluginID: target.pluginID as string, surfaceID: target.surfaceID as string };
  }
  return null;
}

export function decodeActivityNavigation(value: unknown): ActivityNavigationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ActivityNavigationRecord>;
  const target = targetFromRecord(record.target);
  if (record.version !== 1 || !target || !Array.isArray(record.recentBuiltins)) return null;
  const recentBuiltins = [...new Set(record.recentBuiltins.filter(isBuiltinActivityPage))];
  return { version: 1, target, recentBuiltins };
}

function legacyTarget(value: unknown): ActivityRestoreTarget | null {
  if (isBuiltinActivityPage(value)) return { kind: 'builtin', page: value };
  if (typeof value === 'string' && value.startsWith(LEGACY_PLUGIN_PREFIX)) {
    try {
      const inventoryKey = decodeURIComponent(value.slice(LEGACY_PLUGIN_PREFIX.length));
      if (inventoryKey.startsWith('catalog:') || inventoryKey.startsWith('instance:')) return { kind: 'legacy-plugin', inventoryKey };
    } catch { /* Reject malformed old IDs. */ }
  }
  return null;
}

/** One product-owned record. Native UI storage already survives changing loopback ports. */
export function createActivityNavigation(options: { envID?: string; namespace?: string } = {}) {
  let envID = options.envID;
  if (envID === undefined) {
    try { envID = sessionStorage.getItem('redeven_env_public_id') ?? ''; } catch { envID = ''; }
  }
  const desktop = isDesktopStateStorageAvailable();
  // The local runtime's public identity is fixed even before /api/local/runtime resolves.
  const binding = resolveEnvAppStorageBinding({ envID: envID || 'env_local', desktopStateStorageAvailable: desktop });
  const key = rendererScopedUIStorageKey(`${binding.namespace}-activity-navigation`);
  const stored = readUIStorageJSON<unknown>(key, null);
  const saved = decodeActivityNavigation(stored);
  if (saved && JSON.stringify(saved) !== JSON.stringify(stored)) writeUIStorageJSON(key, saved);
  const legacyNamespace = options.namespace ?? resolveEnvAppStorageBinding({ envID, desktopStateStorageAvailable: desktop }).namespace;
  const layoutKey = `${legacyNamespace}-layout`;
  const layout = readUIStorageJSON<{ sidebar?: { activeTab?: unknown } } | null>(layoutKey, null);
  const restoredLayout = layout?.sidebar?.activeTab === 'browser'
    ? { ...layout, sidebar: { ...layout.sidebar, activeTab: 'terminal' } } : layout;
  if (restoredLayout !== layout) writeUIStorageJSON(layoutKey, restoredLayout);
  const legacyTab = readUIStorageItem('redeven_envapp_active_tab');
  if (legacyTab === 'browser') removeUIStorageItem('redeven_envapp_active_tab');
  const initial: ActivityRestoreTarget = saved?.target ?? legacyTarget(restoredLayout?.sidebar?.activeTab)
    ?? legacyTarget(legacyTab) ?? { kind: 'builtin', page: 'terminal' };
  const [record, setRecord] = createSignal<ActivityNavigationRecord>(saved ?? {
    version: 1, target: initial.kind === 'builtin' ? initial : { kind: 'builtin', page: 'terminal' },
    recentBuiltins: initial.kind === 'builtin' ? [initial.page] : [],
  });
  // Legacy dynamic IDs are validated against the directory before migration is committed.
  if (!saved && initial.kind === 'builtin') writeUIStorageJSON(key, record());
  let persisted = saved || initial.kind === 'builtin' ? JSON.stringify(record()) : undefined;
  return {
    key, initial, record,
    commit(target: ActivityTarget) {
      const clean = targetFromRecord(target);
      if (!clean) return;
      const previous = record();
      const recentBuiltins = clean.kind === 'builtin'
        ? [clean.page, ...previous.recentBuiltins.filter(page => page !== clean.page)] : previous.recentBuiltins;
      const next: ActivityNavigationRecord = { version: 1, target: clean, recentBuiltins };
      const serialized = JSON.stringify(next);
      if (serialized === persisted) return;
      persisted = serialized;
      setRecord(next);
      writeUIStorageJSON(key, next);
    },
    fallback(available: (page: BuiltinActivityPage) => boolean = () => true): BuiltinActivityPage {
      return record().recentBuiltins.find(available) ?? 'terminal';
    },
  };
}
export type ActivityNavigation = ReturnType<typeof createActivityNavigation>;
