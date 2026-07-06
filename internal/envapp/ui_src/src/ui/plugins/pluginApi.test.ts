import { beforeEach, describe, expect, it, vi } from 'vitest';

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApiJSON: vi.fn(async (_url: string, _init: RequestInit) => ({ plugins: [] })),
}));

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

describe('plugin API wrapper', () => {
  beforeEach(() => {
    localApiMocks.fetchLocalApiJSON.mockClear();
  });

  it('uses the Redeven proxy plugin namespace for catalog reads', async () => {
    const { listInstalledPlugins } = await import('./pluginApi');
    await listInstalledPlugins();

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/plugins/catalog', { method: 'GET' });
  });

  it('never exposes direct _redevplugin paths from the UI API wrapper', async () => {
    const source = await import('./pluginApi');
    expect(JSON.stringify(source)).not.toContain('/_redevplugin');
  });

  it('maps lifecycle commands to snake_case ReDevPlugin request bodies', async () => {
    const { pluginLifecycleApi } = await import('./pluginApi');

    await pluginLifecycleApi.disable('plugininst_containers');
    await pluginLifecycleApi.uninstall('plugininst_containers', 'delete_data');
    await pluginLifecycleApi.openSurface({
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.activity',
      preferredPlacement: 'activity',
    });

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/plugins/disable', {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: 'plugininst_containers', reason: 'user_disabled' }),
    });
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/plugins/uninstall', {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: 'plugininst_containers', delete_data: true }),
    });
    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/plugins/surfaces/open', {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: 'plugininst_containers', surface_id: 'containers.activity' }),
    });
  });

  it('installs official catalog packages through the host lifecycle API with bundled trust', async () => {
    const { executePluginLifecycleCommand } = await import('./pluginApi');

    await executePluginLifecycleCommand({
      type: 'install',
      pluginID: 'com.redeven.official.containers',
      source: 'official_catalog',
    });

    const installCall = localApiMocks.fetchLocalApiJSON.mock.calls.find(([url]) => url === '/_redeven_proxy/api/plugins/install');
    expect(installCall).toBeTruthy();
    expect(installCall?.[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(installCall?.[1]?.body ?? '{}'));
    expect(body.trust_state).toBe('bundled');
    expect(typeof body.package_base64).toBe('string');
    expect(body.package_base64.length).toBeGreaterThan(1000);
    expect(body.package_base64).not.toMatch(new RegExp('https?:|file:|\\.\\./', 'i'));
  });

  it('updates official catalog packages through the host lifecycle API with bundled trust', async () => {
    const { executePluginLifecycleCommand } = await import('./pluginApi');

    await executePluginLifecycleCommand({
      type: 'update',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      targetVersion: '1.0.0',
    });

    const updateCall = localApiMocks.fetchLocalApiJSON.mock.calls.find(([url]) => url === '/_redeven_proxy/api/plugins/update');
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(updateCall?.[1]?.body ?? '{}'));
    expect(body.plugin_instance_id).toBe('plugininst_containers');
    expect(body.trust_state).toBe('bundled');
    expect(typeof body.package_base64).toBe('string');
    expect(body.package_base64.length).toBeGreaterThan(1000);
    expect(body.package_base64).not.toMatch(new RegExp('https?:|file:|\\.\\./', 'i'));
  });

  it('does not provide URL, file, unsigned local, or developer install helpers', async () => {
    const source = await import('./pluginApi');
    expect(Object.keys(source).join(' ')).not.toMatch(/url|file|unsigned|developer/i);
  });
});
