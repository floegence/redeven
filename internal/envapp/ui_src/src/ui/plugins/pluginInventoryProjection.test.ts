import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';
import {
  buildPluginCenterModel,
  buildPluginPanelModel,
  projectPluginInventory,
} from './pluginInventoryProjection';
import type { ReDevPluginRecord } from './pluginTypes';

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];
const packageHash = officialContainers.distribution.releaseRef.expected_hashes.package_sha256;
const manifestHash = officialContainers.distribution.releaseRef.expected_hashes.manifest_sha256;
const entriesHash = officialContainers.distribution.releaseRef.expected_hashes.entries_sha256;
const otherPackageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
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

  it.each([
    {
      label: 'unsigned execution approval',
      overrides: {
        trust_state: 'unsigned_local' as const,
        trust_assessment: {
          trust_state: 'unsigned_local' as const,
          verified_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
        },
        signature_assessment: {
          state: 'absent' as const,
          reason_codes: ['signature_absent'],
          assessed_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
          assessed_at: '2026-07-24T10:00:00Z',
        },
        execution_approval: {
          state: 'user_approved' as const,
          reason_codes: [],
          assessed_at: '2026-07-24T10:00:00Z',
          approved_at: '2026-07-24T10:01:00Z',
        },
      },
    },
    {
      label: 'package hash mismatch',
      overrides: {
        active_fingerprint: otherPackageHash,
        package_hash: otherPackageHash,
        trust_assessment: {
          trust_state: 'verified' as const,
          verified_hashes: {
            package_sha256: otherPackageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
          verified_signature: {
            algorithm: 'ed25519',
            key_id: 'redeven-official-signing-2026',
          },
        },
      },
    },
    {
      label: 'version mismatch',
      overrides: {
        version: '1.9.0',
        source_provenance: {
          kind: 'package_url' as const,
          source_origin: 'https://plugins.example.com',
          source_path: '/containers-1.9.0.redevplugin',
          redirect_chain: [],
          package_sha256: packageHash,
          resolved_at: '2026-07-24T10:00:00Z',
        },
        manifest: {
          ...installedRecord().manifest,
          plugin: {
            ...installedRecord().manifest.plugin,
            version: '1.9.0',
          },
        },
      },
    },
    {
      label: 'legacy version signed by a non-official key',
      overrides: {
        version: '1.9.0',
        trust_assessment: {
          trust_state: 'verified' as const,
          verified_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
          verified_signature: {
            algorithm: 'ed25519' as const,
            key_id: 'community-signing-key',
          },
        },
        manifest: {
          ...installedRecord().manifest,
          plugin: {
            ...installedRecord().manifest.plugin,
            version: '1.9.0',
          },
        },
      },
    },
  ])('does not let a same-identity $label inherit official catalog presentation', ({ overrides }) => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord(overrides)],
    });

    expect(projection.items).toHaveLength(2);
    const catalogItem = projection.items.find((item) => item.inventoryKey.startsWith('catalog:'));
    const externalItem = projection.items.find((item) => item.inventoryKey.startsWith('instance:'));
    expect(catalogItem).toMatchObject({
      displayName: officialContainers.displayName,
      trustBadge: 'official',
      lifecycleState: 'not_installed',
    });
    expect(externalItem).toMatchObject({
      inventoryKey: `instance:${officialContainers.pluginInstanceID}`,
      pluginInstanceID: officialContainers.pluginInstanceID,
    });
    expect(externalItem).not.toHaveProperty('officialCatalog');
  });

  it('does not join records with a mismatched publisher or plugin instance', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [
        installedRecord({ publisher_id: 'com.example.publisher' }),
        installedRecord({ plugin_instance_id: 'plugini_different_instance' }),
      ],
    });

    expect(projection.items).toHaveLength(3);
    const catalogItem = projection.items.find((item) => item.inventoryKey.startsWith('catalog:'));
    expect(catalogItem).toMatchObject({
      pluginID: officialContainers.pluginID,
      lifecycleState: 'not_installed',
    });
    expect(catalogItem).not.toHaveProperty('pluginInstanceID');
    expect(catalogItem).not.toHaveProperty('defaultLaunchTarget');
    expect(projection.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        inventoryKey: `instance:${officialContainers.pluginInstanceID}`,
        publisher: officialContainers.publisher,
      }),
      expect.objectContaining({
        inventoryKey: 'instance:plugini_different_instance',
        pluginID: officialContainers.pluginID,
      }),
    ]));
  });

  it('keeps installed records that are not matched by the official catalog in the inventory union', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        publisher_id: 'com.example.publisher',
        plugin_id: 'com.example.local.plugin',
        plugin_instance_id: 'plugini_local',
      })],
    });

    expect(projection.items).toHaveLength(2);
    expect(projection.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        inventoryKey: expect.stringMatching(/^catalog:/),
        pluginID: officialContainers.pluginID,
        lifecycleState: 'not_installed',
      }),
      expect.objectContaining({
        inventoryKey: 'instance:plugini_local',
        pluginID: 'com.example.local.plugin',
        pluginInstanceID: 'plugini_local',
      }),
    ]));
  });

  it('keeps multiple installed instances with the same plugin id independently addressable', () => {
    const projection = projectPluginInventory({
      officialCatalog: [],
      installedPlugins: [
        installedRecord({
          publisher_id: 'com.example.publisher',
          plugin_id: 'com.example.toolbox',
          plugin_instance_id: 'plugini_toolbox_alpha',
        }),
        installedRecord({
          publisher_id: 'com.example.publisher',
          plugin_id: 'com.example.toolbox',
          plugin_instance_id: 'plugini_toolbox_beta',
        }),
      ],
    });

    expect(projection.items.map((item) => item.pluginID)).toEqual([
      'com.example.toolbox',
      'com.example.toolbox',
    ]);
    expect(new Set(projection.items.map((item) => item.inventoryKey))).toEqual(new Set([
      'instance:plugini_toolbox_alpha',
      'instance:plugini_toolbox_beta',
    ]));
  });

  it.each([
    ['verified', 'automatic_eligible', 'policy_approved', 'verified'],
    ['absent', 'manual_only', 'user_approved', 'unsigned'],
    ['unknown_signer', 'manual_only', 'user_approved', 'community'],
    ['unavailable', 'manual_only', 'user_approved', 'unavailable'],
    ['invalid', 'manual_only', 'policy_blocked', 'blocked'],
    ['revoked', 'manual_only', 'policy_blocked', 'revoked'],
  ] as const)(
    'projects %s external trust, approval, provenance, and update eligibility',
    (signatureState, updateState, approvalState, trustBadge) => {
      const external = installedRecord({
        publisher_id: 'com.example.publisher',
        plugin_id: 'com.example.toolbox',
        plugin_instance_id: `plugini_${signatureState}`,
        signature_assessment: {
          state: signatureState,
          reason_codes: [],
          assessed_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
          assessed_at: '2026-07-24T10:00:00Z',
        },
        source_provenance: {
          kind: 'package_url',
          source_origin: 'https://plugins.example.com',
          source_path: '/toolbox.redevplugin',
          redirect_chain: [],
          package_sha256: packageHash,
          resolved_at: '2026-07-24T10:00:00Z',
        },
        execution_approval: {
          state: approvalState,
          reason_codes: [],
          assessed_at: '2026-07-24T10:00:00Z',
        },
        update_eligibility: {
          state: updateState,
          reason_codes: [],
          assessed_at: '2026-07-24T10:00:00Z',
        },
        security_summary: {
          summary_sha256: 'sha256:9b30eca232030072294fcabdc98df492609672c92d2d04a545d5790119d1822b',
          permissions: [],
          methods: [],
          capability_contracts: [],
          workers: [],
          network: [],
          storage: [],
          secret_refs: [],
          core_actions: [],
          intents: [],
          surfaces: [],
        },
      });

      const projection = projectPluginInventory({ officialCatalog: [], installedPlugins: [external] });

      expect(projection.items[0]).toMatchObject({
        inventoryKey: `instance:plugini_${signatureState}`,
        trustBadge,
        externalPackage: {
          signatureAssessment: { state: signatureState },
          sourceProvenance: { kind: 'package_url', package_sha256: packageHash },
          executionApproval: { state: approvalState },
          updateEligibility: { state: updateState },
          securitySummary: { permissions: [], methods: [] },
        },
      });
    },
  );

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

    const installedItem = projection.items.find((item) => item.inventoryKey.startsWith('instance:'));
    expect(installedItem).toMatchObject({
      lifecycleState: 'needs_attention',
      trustBadge: 'unavailable',
      attentionReason: 'trust_unavailable',
      defaultLaunchTarget: undefined,
    });
    const installedTile = buildPluginPanelModel(projection, undefined, { canOpenSurfaces: true }).tiles
      .find((tile) => tile.kind === 'plugin' && tile.item.inventoryKey.startsWith('instance:'));
    expect(installedTile).toMatchObject({
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
