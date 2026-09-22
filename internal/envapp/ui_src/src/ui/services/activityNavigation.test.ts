// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityNavigation, decodeActivityNavigation, PENDING_ACTIVITY_PLUGIN_ID, activityTargetID } from './activityNavigation';
import { resolveEnvAppStorageBinding } from './uiPersistence';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
const pages = ['terminal', 'monitor', 'files', 'codespaces', 'ports', 'applications', 'containers', 'ai', 'settings', 'plugin-center'] as const;
describe('Activity navigation record', () => {
  it.each(pages)('restores %s immediately across new owners', page => {
    const first = createActivityNavigation({ envID: 'host-a' });
    first.commit({ kind: 'builtin', page });
    expect(createActivityNavigation({ envID: 'host-a' }).initial).toEqual({ kind: 'builtin', page });
  });
  it('migrates Floe before the old product record, then ignores both legacy owners', () => {
    const namespace = resolveEnvAppStorageBinding({ envID: 'host', desktopStateStorageAvailable: false }).namespace;
    localStorage.setItem(`${namespace}-layout`, JSON.stringify({ sidebar: { activeTab: 'settings' } }));
    localStorage.setItem('redeven_envapp_active_tab', 'ports');
    const nav = createActivityNavigation({ envID: 'host' });
    expect(nav.initial).toEqual({ kind: 'builtin', page: 'settings' });
    nav.commit({ kind: 'builtin', page: 'ports' });
    expect(createActivityNavigation({ envID: 'host' }).initial).toEqual({ kind: 'builtin', page: 'ports' });
    expect(JSON.parse(localStorage.getItem(`${namespace}-layout`)!).sidebar.activeTab).toBe('settings');
  });
  it('uses valid legacy product data or terminal when the prior layout cannot be restored', () => {
    localStorage.setItem('redeven_envapp_active_tab', 'ports');
    expect(createActivityNavigation({ envID: 'a' }).initial).toEqual({ kind: 'builtin', page: 'ports' });
    localStorage.setItem('redeven_envapp_active_tab', 'connection-menu');
    expect(createActivityNavigation({ envID: 'b' }).initial).toEqual({ kind: 'builtin', page: 'terminal' });
  });
  it('keeps recent builtins unique and selects the latest available fallback', () => {
    const nav = createActivityNavigation();
    for (const page of ['ports', 'settings', 'files', 'ports'] as const) nav.commit({ kind: 'builtin', page });
    nav.commit({ kind: 'plugin', pluginInstanceID: 'instance', pluginID: 'plugin', surfaceID: 'main' });
    expect(nav.record().recentBuiltins).toEqual(['ports', 'files', 'settings', 'terminal']);
    expect(nav.fallback(page => page !== 'ports')).toBe('files');
    expect(nav.fallback(() => false)).toBe('terminal');
  });
  it('persists stable plugin identity only and preserves it while validating', () => {
    const nav = createActivityNavigation();
    nav.commit({ kind: 'plugin', pluginInstanceID: 'instance', pluginID: 'plugin', surfaceID: 'main', token: 'secret', managementRevision: 7 } as never);
    const restored = createActivityNavigation();
    expect(activityTargetID(restored.initial)).toBe(PENDING_ACTIVITY_PLUGIN_ID);
    expect(JSON.parse(localStorage.getItem(nav.key)!).target).toEqual({ kind: 'plugin', pluginInstanceID: 'instance', pluginID: 'plugin', surfaceID: 'main' });
    expect(restored.record().target).toEqual(nav.record().target);
  });
  it('does not publish an unvalidated legacy plugin as a new record', () => {
    localStorage.setItem('redeven_envapp_active_tab', 'redeven.plugin.activity:instance%3Asample');
    const nav = createActivityNavigation();
    expect(nav.initial).toEqual({ kind: 'legacy-plugin', inventoryKey: 'instance:sample' });
    expect(localStorage.getItem(nav.key)).toBeNull();
    nav.commit({ kind: 'builtin', page: 'terminal' });
    expect(localStorage.getItem(nav.key)).not.toBeNull();
  });
  it('isolates environments and handles corrupted or incompatible records', () => {
    const nav = createActivityNavigation({ envID: 'a' });
    nav.commit({ kind: 'builtin', page: 'settings' });
    expect(createActivityNavigation({ envID: 'b' }).initial).toEqual({ kind: 'builtin', page: 'terminal' });
    localStorage.setItem(nav.key, '{');
    expect(createActivityNavigation({ envID: 'a' }).initial).toEqual({ kind: 'builtin', page: 'terminal' });
    expect(decodeActivityNavigation({ version: 2, target: { kind: 'builtin', page: 'files' }, recentBuiltins: [] })).toBeNull();
    expect(decodeActivityNavigation({ version: 1, target: { kind: 'plugin', pluginInstanceID: '', pluginID: 'p', surfaceID: 's' }, recentBuiltins: [] })).toBeNull();
  });
  it('uses the native environment/source scope rather than a renderer port or window identity', () => {
    const values = new Map<string, string>();
    let source = 'local-environment-a';
    window.redevenDesktopStateStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, keys: () => [...values.keys()] };
    window.redevenDesktopSessionContext = { getSnapshot: () => ({ local_environment_id: 'environment-a', renderer_storage_scope_id: source, target_route: 'local_host', session_source: 'local_runtime' }) };
    try {
      const first = createActivityNavigation({ envID: 'env_local' });
      first.commit({ kind: 'builtin', page: 'settings' });
      expect(createActivityNavigation({ envID: 'env_local' }).initial).toEqual(first.record().target);
      source = 'provider-environment-a';
      expect(createActivityNavigation({ envID: 'env_local' }).initial).toEqual({ kind: 'builtin', page: 'terminal' });
      source = 'local-environment-b';
      expect(createActivityNavigation({ envID: 'env_local' }).initial).toEqual({ kind: 'builtin', page: 'terminal' });
      source = 'local-environment-a';
      expect(createActivityNavigation({ envID: 'env_local' }).initial).toEqual({ kind: 'builtin', page: 'settings' });
    } finally { delete window.redevenDesktopStateStorage; delete window.redevenDesktopSessionContext; }
  });

  it('keeps navigation usable when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const nav = createActivityNavigation();
    nav.commit({ kind: 'builtin', page: 'files' });
    expect(nav.record().target).toEqual({ kind: 'builtin', page: 'files' });
  });
});
