import { describe, expect, it } from 'vitest';

import {
  buildPluginCenterModel,
  buildPluginPanelModel,
  projectPluginInventory,
} from './pluginInventoryProjection';
import type { OfficialPluginCatalogItem, ReDevPluginRecord } from './pluginTypes';

const officialContainers: OfficialPluginCatalogItem = {
  pluginID: 'com.redeven.official.containers',
  displayName: 'Containers',
  description: 'Manage Docker and Podman resources.',
  publisher: 'Redeven',
  latestVersion: '1.0.0',
  stableVersion: '1.0.0',
  minRedevenVersion: '0.1.0',
  minReDevPluginVersion: '0.1.1',
  rolloutState: 'stable',
  defaultSurfaceID: 'containers.activity',
  iconFallback: 'containers',
  distribution: {
    releaseChannel: 'github_release_and_redeven_cdn',
    artifactName: 'containers-1.0.0.redevplugin',
    officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
  },
};

function installedRecord(overrides: Partial<ReDevPluginRecord> = {}): ReDevPluginRecord {
  return {
    plugin_instance_id: 'plugininst_containers',
    plugin_id: officialContainers.pluginID,
    version: '1.0.0',
    active_fingerprint: 'sha256:pkg',
    trust_state: 'verified',
    enable_state: 'enabled',
    installed_at: '2026-07-04T10:00:00Z',
    enabled_at: '2026-07-04T10:01:00Z',
    manifest: {
      plugin: {
        display_name: 'Containers',
      },
      surfaces: [
        {
          surface_id: 'containers.activity',
          label: 'Containers',
        },
      ],
    },
    ...overrides,
  };
}

describe('plugin inventory projection', () => {
  it('keeps Plugin Center as the first panel tile', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [],
    });

    const panel = buildPluginPanelModel(projection);
    expect(panel.tiles[0]).toMatchObject({ kind: 'open_center', id: 'plugin-center' });
  });

  it('merges official catalog and installed registry records by plugin id', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginID: officialContainers.pluginID,
      pluginInstanceID: 'plugininst_containers',
      displayName: 'Containers',
      lifecycleState: 'enabled',
      trustBadge: 'official',
      defaultLaunchTarget: {
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.activity',
        preferredPlacement: 'activity',
      },
    });
  });

  it('keeps non-official installed records out of the official-only inventory', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [
        installedRecord({
          plugin_id: 'com.example.local.plugin',
          plugin_instance_id: 'plugininst_local',
          manifest: {
            plugin: {
              display_name: 'Local Plugin',
            },
            surfaces: [
              {
                surface_id: 'local.activity',
                label: 'Local',
              },
            ],
          },
        }),
      ],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0].pluginID).toBe(officialContainers.pluginID);
    expect(projection.items.some((item) => item.pluginID === 'com.example.local.plugin')).toBe(false);
  });

  it('routes enabled plugins to surface launch targets when the shell can host surfaces', () => {
    const enabledProjection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
    });
    const disabledProjection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ enable_state: 'disabled', disabled_reason: 'user' })],
    });

    expect(buildPluginPanelModel(enabledProjection).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
    expect(buildPluginPanelModel(enabledProjection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_surface',
    });
    expect(buildPluginPanelModel(disabledProjection).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
  });

  it('does not show revoked official plugins as installable', () => {
    const revoked: OfficialPluginCatalogItem = { ...officialContainers, rolloutState: 'revoked' };
    const projection = projectPluginInventory({
      officialCatalog: [revoked],
      installedPlugins: [],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      trustBadge: 'revoked',
      attentionReason: 'catalog_revoked',
    });
    expect(buildPluginPanelModel(projection).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
  });

  it('keeps non-runnable installed trust states out of enable and open flows', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ trust_state: 'needs_review' })],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      trustBadge: 'unavailable',
      attentionReason: 'trust_unavailable',
      defaultLaunchTarget: undefined,
    });
    expect(buildPluginPanelModel(projection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
    expect(buildPluginCenterModel(projection).updates).toHaveLength(0);
  });

  it('does not treat unsigned local installs as official runnable plugins', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ trust_state: 'unsigned_local' })],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      trustBadge: 'unavailable',
      attentionReason: 'trust_unavailable',
      defaultLaunchTarget: undefined,
    });
    expect(buildPluginPanelModel(projection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
  });

  it('sorts pinned and recently opened plugins deterministically after the center tile', () => {
    const github: OfficialPluginCatalogItem = {
      ...officialContainers,
      pluginID: 'com.redeven.official.github',
      displayName: 'GitHub',
      defaultSurfaceID: 'github.activity',
      iconFallback: 'github',
    };

    const projection = projectPluginInventory({
      officialCatalog: [github, officialContainers],
      installedPlugins: [
        installedRecord({ plugin_id: github.pluginID, plugin_instance_id: 'plugininst_github', metadata: { pinned: 'true' } }),
        installedRecord({ plugin_instance_id: 'plugininst_containers', metadata: { last_opened_at: '2026-07-04T11:00:00Z' } }),
      ],
    });

    const panel = buildPluginPanelModel(projection);
    expect(panel.tiles.map((tile) => (tile.kind === 'plugin' ? tile.item.pluginID : tile.id))).toEqual([
      'plugin-center',
      github.pluginID,
      officialContainers.pluginID,
    ]);
  });

  it('builds installed, discover, and updates center buckets', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ version: '0.9.0' })],
    });

    const center = buildPluginCenterModel(projection, 'updates');
    expect(center.installed).toHaveLength(1);
    expect(center.discover).toHaveLength(0);
    expect(center.updates).toHaveLength(1);
    expect(center.updates[0].lifecycleState).toBe('update_available');
  });
});
