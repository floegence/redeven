import type { PluginPlatformClient } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginLifecycleAPI } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];

function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async () => ({ plugins: [] })),
    installReleaseRef: vi.fn(async () => ({})),
    updateReleaseRef: vi.fn(async () => ({})),
    enablePlugin: vi.fn(async () => ({})),
    disablePlugin: vi.fn(async () => ({})),
    uninstallPlugin: vi.fn(async () => ({})),
  };
  return {
    mocks,
    lifecycle: createPluginLifecycleAPI(mocks as unknown as PluginPlatformClient),
  };
}

describe('v0.5.1 plugin lifecycle client integration', () => {
  it('loads inventory exclusively through the platform catalog client', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.listInstalledPlugins()).resolves.toEqual([]);
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.catalog).toHaveBeenCalledWith({});
  });

  it('installs the generated signed release under the fixed official identity', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await lifecycle.execute({
      type: 'install',
      pluginID: officialContainers.pluginID,
      source: 'official_catalog',
    });

    expect(mocks.installReleaseRef).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
    }, {});
    expect(OFFICIAL_CONTAINERS_RELEASE_REF).toMatchObject({
      publisher_id: officialContainers.publisherID,
      plugin_id: officialContainers.pluginID,
      version: officialContainers.stableVersion,
    });
  });

  it('updates the exact installed instance with its management revision and generated release ref', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await lifecycle.execute({
      type: 'update',
      pluginID: officialContainers.pluginID,
      pluginInstanceID: officialContainers.pluginInstanceID,
      expectedManagementRevision: 17,
      targetVersion: OFFICIAL_CONTAINERS_RELEASE_REF.version,
    });

    expect(mocks.updateReleaseRef).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      expected_management_revision: 17,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
    }, {});
  });

  it('rejects an update whose requested version is not the signed release version', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.execute({
      type: 'update',
      pluginID: officialContainers.pluginID,
      pluginInstanceID: officialContainers.pluginInstanceID,
      expectedManagementRevision: 17,
      targetVersion: '1.9.9',
    })).rejects.toThrow('does not match its signed release reference');
    expect(mocks.updateReleaseRef).not.toHaveBeenCalled();
  });

  it('propagates management revisions through enable, disable, and uninstall mutations', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await lifecycle.execute({
      type: 'enable',
      pluginInstanceID: officialContainers.pluginInstanceID,
      expectedManagementRevision: 4,
    });
    await lifecycle.execute({
      type: 'disable',
      pluginInstanceID: officialContainers.pluginInstanceID,
      expectedManagementRevision: 5,
    });
    await lifecycle.execute({
      type: 'uninstall',
      pluginInstanceID: officialContainers.pluginInstanceID,
      expectedManagementRevision: 6,
      dataRetention: 'delete_data',
    });

    expect(mocks.enablePlugin).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      expected_management_revision: 4,
    }, {});
    expect(mocks.disablePlugin).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      expected_management_revision: 5,
      reason: 'user_disabled',
    }, {});
    expect(mocks.uninstallPlugin).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      expected_management_revision: 6,
      delete_data: true,
    }, {});
  });
});
