import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';
import {
  buildPluginCenterModel,
  buildPluginPanelModel,
  projectPluginInventory,
} from './pluginInventoryProjection';
import type { ReDevPluginRecord } from './pluginTypes';

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];
const packageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
const manifestHash = 'sha256:f96534ca709165d0e30f6e7713a57ec0754f84f84ccadc2edc000f19dde7cc3d';
const entriesHash = 'sha256:8a0048517719d934e52406dc6e9964d9ca165728d3e530d2c4df16f619bf17fa';
const readGrant = {
  plugin_instance_id: officialContainers.pluginInstanceID,
  permission_id: 'containers.read',
  effect: 'grant',
  granted_at: '2026-07-04T10:02:00Z',
} as const;

function installedRecord(overrides: Partial<ReDevPluginRecord> = {}): ReDevPluginRecord {
  return {
    plugin_instance_id: officialContainers.pluginInstanceID,
    publisher_id: officialContainers.publisherID,
    plugin_id: officialContainers.pluginID,
    version: officialContainers.stableVersion,
    active_fingerprint: packageHash,
    package_hash: packageHash,
    manifest_hash: manifestHash,
    entries_hash: entriesHash,
    trust_state: 'verified',
    trust_assessment: {
      trust_state: 'verified',
      verified_hashes: {
        package_sha256: packageHash,
        manifest_sha256: manifestHash,
        entries_sha256: entriesHash,
      },
      verified_signature: {
        algorithm: 'ed25519',
        key_id: 'redeven-official-signing-2026',
      },
    },
    enable_state: 'enabled',
    policy_revision: 3,
    management_revision: 7,
    revoke_epoch: 0,
    manifest: {
      schema_version: 'redevplugin.manifest.v5',
      publisher: {
        publisher_id: officialContainers.publisherID,
        display_name: officialContainers.publisher,
      },
      plugin: {
        plugin_id: officialContainers.pluginID,
        display_name: officialContainers.displayName,
        version: officialContainers.stableVersion,
        api_version: 'plugin-v1',
        min_runtime_version: '0.6.5',
        ui_protocol_version: 'plugin-ui-v5',
      },
      surfaces: [
        {
          surface_id: officialContainers.defaultSurfaceID,
          kind: 'view',
          intent: 'primary',
          label: officialContainers.displayName,
          entry: 'ui/index.html',
        },
      ],
    },
    package_entries: [],
    installed_at: '2026-07-04T10:00:00Z',
    enabled_at: '2026-07-04T10:01:00Z',
    updated_at: '2026-07-04T10:01:00Z',
    ...overrides,
  };
}

describe('v0.6.7 plugin inventory projection', () => {
  it('keeps Plugin Center as the first panel tile', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [],
    });

    const panel = buildPluginPanelModel(projection);
    expect(panel.tiles[0]).toMatchObject({ kind: 'open_center', id: 'plugin-center' });
  });

  it('joins the registry record only by exact publisher, plugin, and instance identity', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginID: officialContainers.pluginID,
      pluginInstanceID: officialContainers.pluginInstanceID,
      displayName: officialContainers.displayName,
      lifecycleState: 'enabled',
      trustBadge: 'official',
      managementRevision: 7,
      defaultLaunchTarget: {
        pluginID: officialContainers.pluginID,
        pluginInstanceID: officialContainers.pluginInstanceID,
        surfaceID: officialContainers.defaultSurfaceID,
        expectedManagementRevision: 7,
        preferredPlacement: 'activity',
      },
    });
  });

  it('does not join records with a mismatched publisher or plugin instance', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [
        installedRecord({ publisher_id: 'com.example.publisher' }),
        installedRecord({ plugin_instance_id: 'plugini_different_instance' }),
      ],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginID: officialContainers.pluginID,
      lifecycleState: 'not_installed',
    });
    expect(projection.items[0]).not.toHaveProperty('pluginInstanceID');
    expect(projection.items[0]).not.toHaveProperty('defaultLaunchTarget');
  });

  it('keeps non-official installed records out of the official-only inventory', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        publisher_id: 'com.example.publisher',
        plugin_id: 'com.example.local.plugin',
        plugin_instance_id: 'plugini_local',
      })],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginID: officialContainers.pluginID,
      lifecycleState: 'not_installed',
    });
  });

  it('routes only enabled verified records with a revision-bound launch target', () => {
    const enabledProjection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
    });
    const disabledProjection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ enable_state: 'disabled', disabled_reason: 'user_disabled' })],
    });

    expect(buildPluginPanelModel(enabledProjection).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
    expect(buildPluginPanelModel(enabledProjection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_surface',
      item: {
        defaultLaunchTarget: {
          expectedManagementRevision: 7,
        },
      },
    });
    expect(buildPluginPanelModel(disabledProjection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_details',
    });
  });

  it('requires an active read grant before exposing the Containers launch target', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      attentionReason: 'permission_required',
      defaultLaunchTarget: undefined,
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', granted: false }),
        ]),
      },
    });
  });

  it('keeps an explicit deny distinct from a missing grant', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [{ ...readGrant, effect: 'deny' }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      attentionReason: 'permission_required',
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({
            permissionID: 'containers.read',
            granted: false,
            deniedByGrant: true,
            blockedByPolicy: false,
            grantBlockedByPolicy: false,
            blockedToOpen: false,
          }),
        ]),
      },
    });
  });

  it('treats an empty policy allowlist as uncapped and carries its CAS revisions', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: officialContainers.pluginInstanceID,
        allowed_permissions: [],
        denied_methods: [],
        policy_revision: 19,
        management_revision: 23,
        revoke_epoch: 5,
        updated_at: '2026-07-04T10:03:00Z',
      }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      authorization: {
        revisions: { policyRevision: 19, managementRevision: 23, revokeEpoch: 5 },
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', blockedByPolicy: false }),
        ]),
      },
    });
  });

  it.each([
    {
      allowed_permissions: ['containers.execute'],
      denied_methods: [],
    },
    {
      allowed_permissions: [],
      denied_methods: ['containers.list'],
    },
  ])('marks the required read permission as policy restricted for %#', (policyRules) => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: officialContainers.pluginInstanceID,
        ...policyRules,
        policy_revision: 8,
        management_revision: 7,
        revoke_epoch: 0,
        updated_at: '2026-07-04T10:03:00Z',
      }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      attentionReason: 'policy_restricted',
      defaultLaunchTarget: undefined,
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', granted: true, blockedByPolicy: true }),
        ]),
      },
    });
  });

  it('keeps the Dashboard launchable when policy denies a non-opening read method', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: officialContainers.pluginInstanceID,
        allowed_permissions: [],
        denied_methods: ['containers.inspect'],
        policy_revision: 8,
        management_revision: 7,
        revoke_epoch: 0,
        updated_at: '2026-07-04T10:03:00Z',
      }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      attentionReason: undefined,
      defaultLaunchTarget: expect.objectContaining({ surfaceID: 'containers.dashboard' }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({
            permissionID: 'containers.read',
            blockedByPolicy: true,
            grantBlockedByPolicy: false,
            blockedToOpen: false,
          }),
        ]),
      },
    });
  });

  it('does not show a revoked official release as installable', () => {
    const projection = projectPluginInventory({
      officialCatalog: [{ ...officialContainers, rolloutState: 'revoked' }],
      installedPlugins: [],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      trustBadge: 'revoked',
      attentionReason: 'catalog_revoked',
    });
  });

  it('keeps non-runnable trust states out of enable and open flows', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        trust_state: 'needs_review',
        trust_assessment: {
          trust_state: 'needs_review',
          verified_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
        },
      })],
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

  it('builds installed and update buckets from the typed registry record', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ version: '1.9.0' })],
    });

    const center = buildPluginCenterModel(projection, 'updates');
    expect(center.installed).toHaveLength(1);
    expect(center.discover).toHaveLength(0);
    expect(center.updates).toHaveLength(1);
    expect(center.updates[0]).toMatchObject({
      lifecycleState: 'update_available',
      managementRevision: 7,
    });
  });

  it('orders strict SemVer prereleases before the matching stable release', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ version: '2.0.0-rc.1' })],
    });

    expect(projection.items[0]).toMatchObject({ lifecycleState: 'update_available' });
    expect(buildPluginCenterModel(projection, 'updates').updates).toHaveLength(1);
  });

  it.each(['v2.0.0', ' 2.0.0', '2.0.0 ', '02.0.0'])(
    'rejects a non-canonical plugin version %j',
    (version) => {
      expect(() => projectPluginInventory({
        officialCatalog: [officialContainers],
        installedPlugins: [installedRecord({ version })],
      })).toThrow('canonical strict SemVer');
    },
  );
});
