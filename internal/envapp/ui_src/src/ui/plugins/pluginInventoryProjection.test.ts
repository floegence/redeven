import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog.test-fixture';
import {
  buildPluginCenterModel,
  buildPluginPanelModel,
  projectPluginInventory,
} from './pluginInventoryProjection';
import type { ReDevPluginRecord } from './pluginTypes';
import type { PluginPermissionRequirements } from '@floegence/redevplugin-ui';

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
  const marketIcon = officialContainers.presentation?.icon;
  const iconPath = 'ui/assets/containers-plugin.png';
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
        key_id: 'redeven_official_signing_2026',
      },
    },
    enable_state: 'enabled',
    action_state: {
      can_open: true,
      can_enable: false,
      can_disable: true,
      can_uninstall: true,
    },
    policy_revision: 3,
    management_revision: 7,
    revoke_epoch: 0,
    manifest: {
      schema_version: 'redevplugin.manifest.v9',
      publisher: {
        publisher_id: officialContainers.publisherID,
        display_name: officialContainers.publisher,
      },
      plugin: {
        plugin_id: officialContainers.pluginID,
        display_name: officialContainers.displayName,
        version: officialContainers.stableVersion,
      },
      api: { surface: 1, worker: 1 },
      permissions: [],
      presentation: { locales: { default: 'en-US' }, icon: { path: iconPath } },
      surfaces: [
        {
          surface_id: officialContainers.defaultSurfaceID,
          kind: 'view',
          intent: 'primary',
          label: officialContainers.displayName,
          entry: 'ui/index.html',
        },
      ],
      workers: [],
      methods: [],
    },
    package_entries: marketIcon ? [{
      path: iconPath,
      size: 286_539,
      sha256: `sha256:${marketIcon.sha256}`,
      mode: '0644',
      content_type: marketIcon.media_type,
    }] : [],
    installed_at: '2026-07-04T10:00:00Z',
    enabled_at: '2026-07-04T10:01:00Z',
    updated_at: '2026-07-04T10:01:00Z',
    ...overrides,
  };
}

describe('v1.1.4 plugin inventory projection', () => {
  it('keeps Plugin Center as the first panel tile', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [],
    });

    const panel = buildPluginPanelModel(projection);
    expect(panel.tiles[0]).toMatchObject({ kind: 'open_center', id: 'plugin-center' });
    expect(panel.tiles).toHaveLength(1);
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
      iconURL: `/_redevplugin/api/plugins/${encodeURIComponent(officialContainers.pluginInstanceID)}/icon/${officialContainers.presentation?.icon?.sha256}`,
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

  it('uses the Host action state as the only launch authority', () => {
    const blockedByHost = {
      ...installedRecord(),
      action_state: {
        can_open: false,
        can_enable: false,
        can_disable: true,
        can_uninstall: true,
        blocked_reason: 'runtime_unavailable',
        recovery_action: 'retry',
      },
    } as ReDevPluginRecord;
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [blockedByHost],
      permissionGrants: [readGrant],
    });

    const item = projection.items[0];
    expect(item?.defaultLaunchTarget).toBeUndefined();
    expect(buildPluginPanelModel(projection).tiles).toHaveLength(1);
    expect(buildPluginCenterModel(projection).installed[0]?.defaultLaunchTarget).toBeUndefined();
  });

  it('uses an installed package icon URL without a market catalog', () => {
    const iconPath = 'ui/assets/containers-plugin.png';
    const iconDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const projection = projectPluginInventory({
      officialCatalog: [],
      installedPlugins: [installedRecord({
        manifest: {
          ...installedRecord().manifest,
          presentation: { ...installedRecord().manifest.presentation, icon: { path: iconPath } },
        },
        package_entries: [{
          path: iconPath,
          size: 123,
          sha256: iconDigest,
          mode: '0644',
          content_type: 'image/png',
        }],
      })],
    });

    expect(projection.items[0]?.iconURL).toBe(
      `/_redevplugin/api/plugins/${encodeURIComponent(officialContainers.pluginInstanceID)}/icon/${iconDigest.slice(7)}`,
    );
  });

  it('uses an installed package icon URL even when the market release identity differs', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        version: officialContainers.stableVersion,
        manifest_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        manifest: {
          ...installedRecord().manifest,
          presentation: { ...installedRecord().manifest.presentation, icon: { path: 'ui/status.png' } },
        },
        package_entries: [{
          path: 'ui/status.png',
          size: 123,
          sha256: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          mode: '0644',
          content_type: 'image/png',
        }],
      })],
      permissionGrants: [readGrant],
    });

    const installed = projection.items.find((item) => item.pluginInstanceID === officialContainers.pluginInstanceID);
    expect(installed?.iconURL).toContain('/_redevplugin/api/plugins/');
    expect(installed?.iconURL).toContain('/icon/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('uses the content-addressed installed icon when an older release binds the same bytes', () => {
    const marketIcon = officialContainers.presentation?.icon;
    expect(marketIcon).toBeDefined();
    const iconPath = 'ui/assets/containers-plugin.png';
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        version: '4.4.1',
        manifest: {
          ...installedRecord().manifest,
          plugin: { ...installedRecord().manifest.plugin, version: '4.4.1' },
          presentation: {
            ...installedRecord().manifest.presentation,
            icon: { path: iconPath },
          },
        },
        package_entries: [{
          path: iconPath,
          size: 286_539,
          sha256: `sha256:${marketIcon!.sha256}`,
          mode: '0644',
          content_type: marketIcon!.media_type,
        }],
      })],
      permissionGrants: [readGrant],
    });

    const installed = projection.items.find((item) => item.pluginInstanceID === officialContainers.pluginInstanceID);
    expect(installed?.iconURL).toBe(
      `/_redevplugin/api/plugins/${encodeURIComponent(officialContainers.pluginInstanceID)}/icon/${marketIcon!.sha256}`,
    );
  });

  it('rejects an installed icon entry with an unsupported media type', () => {
    const iconPath = 'ui/assets/containers-plugin.png';
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        version: '4.4.1',
        manifest: {
          ...installedRecord().manifest,
          plugin: { ...installedRecord().manifest.plugin, version: '4.4.1' },
          presentation: {
            ...installedRecord().manifest.presentation,
            icon: { path: iconPath },
          },
        },
        package_entries: [{
          path: iconPath,
          size: 286_539,
          sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          mode: '0644',
          content_type: 'image/svg+xml',
        }],
      })],
      permissionGrants: [readGrant],
    });

    const installed = projection.items.find((item) => item.pluginInstanceID === officialContainers.pluginInstanceID);
    expect(installed?.iconURL).toBeUndefined();
  });

  it('does not project market author copy into an installed record without presentation', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        manifest: {
          ...installedRecord().manifest,
          publisher: {
            publisher_id: officialContainers.publisherID,
            display_name: 'Installed Publisher',
          },
          plugin: {
            ...installedRecord().manifest.plugin,
            display_name: '',
          },
        },
        presentation: undefined,
      })],
      permissionGrants: [readGrant],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginInstanceID: officialContainers.pluginInstanceID,
      displayName: officialContainers.pluginID,
      description: officialContainers.pluginID,
      publisher: 'Installed Publisher',
      searchKeywords: [],
      defaultLaunchTarget: {
        displayName: officialContainers.pluginID,
      },
    });
    expect(projection.items[0]?.description).not.toBe(officialContainers.description);
  });

  const catalogPresentationMismatchCases: Array<{
    label: string;
    overrides: Partial<ReDevPluginRecord>;
  }> = [
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
            key_id: 'redeven_official_signing_2026',
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
      },
    },
  ];

  it.each(catalogPresentationMismatchCases)('does not let a same-identity $label inherit official catalog presentation', ({ overrides }) => {
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

  it('binds exact unsigned catalog content to its generated installed instance without upgrading trust', () => {
    const pluginInstanceID = 'plugin_generated_containers';
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({
        plugin_instance_id: pluginInstanceID,
        trust_state: 'unsigned_local',
        trust_assessment: {
          trust_state: 'unsigned_local',
          verified_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
        },
        signature_assessment: {
          state: 'absent',
          reason_codes: ['signature_not_present'],
          assessed_hashes: {
            package_sha256: packageHash,
            manifest_sha256: manifestHash,
            entries_sha256: entriesHash,
          },
          assessed_at: '2026-07-24T10:00:00Z',
        },
        execution_approval: {
          state: 'user_approved',
          reason_codes: [],
          assessed_at: '2026-07-24T10:00:00Z',
          approved_at: '2026-07-24T10:01:00Z',
        },
        enable_state: 'disabled',
        enabled_at: undefined,
      })],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      inventoryKey: `instance:${pluginInstanceID}`,
      pluginInstanceID,
      displayName: officialContainers.displayName,
      trustBadge: 'unsigned',
      lifecycleState: 'disabled',
      officialCatalog: { pluginID: officialContainers.pluginID },
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', requiredToOpen: true }),
        ]),
      },
    });
    expect(buildPluginCenterModel(projection, 'installed').discover).toHaveLength(0);
  });

  it('keeps a mismatched publisher separate while binding exact catalog content from any generated instance', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [
        installedRecord({ publisher_id: 'com.example.publisher' }),
        installedRecord({ plugin_instance_id: 'plugini_different_instance' }),
      ],
    });

    expect(projection.items).toHaveLength(2);
    const catalogItem = projection.items.find((item) => item.inventoryKey === 'instance:plugini_different_instance');
    expect(catalogItem).toMatchObject({
      pluginID: officialContainers.pluginID,
      pluginInstanceID: 'plugini_different_instance',
      officialCatalog: { pluginID: officialContainers.pluginID },
    });
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
      installedPlugins: [installedRecord({
        enable_state: 'disabled',
        disabled_reason: 'user_disabled',
        action_state: {
          can_open: false,
          can_enable: true,
          can_disable: false,
          can_uninstall: true,
        },
      })],
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
    expect(buildPluginPanelModel(disabledProjection, undefined, { canOpenSurfaces: true }).tiles).toHaveLength(1);
  });

  it('keeps an enabled plugin launchable from the panel when an update is available', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord({ version: '1.9.0' })],
      permissionGrants: [readGrant],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'update_available',
      attentionReason: 'update_required',
      defaultLaunchTarget: {
        expectedManagementRevision: 7,
      },
    });
    expect(buildPluginPanelModel(projection, undefined, { canOpenSurfaces: true }).tiles[1]).toMatchObject({
      kind: 'plugin',
      action: 'open_surface',
    });
  });

  it('does not override Host launch authority when an active read grant is missing', () => {
    const projection = projectPluginInventory({
      officialCatalog: [officialContainers],
      installedPlugins: [installedRecord()],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      attentionReason: 'permission_required',
      defaultLaunchTarget: expect.objectContaining({ surfaceID: officialContainers.defaultSurfaceID }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', granted: false }),
        ]),
      },
    });
  });

  it('projects Host-verified requirements when the market catalog has no permission metadata', () => {
    const requirements: PluginPermissionRequirements = {
      plugin_instance_id: officialContainers.pluginInstanceID,
      plugin_version: officialContainers.stableVersion,
      active_fingerprint: packageHash,
      management_revision: 7,
      required_permissions: ['containers.read', 'containers.execute'],
      contracts: [{
        contract_id: 'redeven.container_resources.v4',
        contract_version: '4.0.0',
        contract_sha256: 'a'.repeat(64),
        capability_id: 'redeven.capability.container_resources',
        capability_version: '3.0.0',
        methods: [
          { method: 'containers.list', required_permissions: ['containers.read'] },
          { method: 'containers.start', required_permissions: ['containers.execute'] },
        ],
      }],
    };
    const projection = projectPluginInventory({
      officialCatalog: [{ ...officialContainers, permissions: [] }],
      installedPlugins: [installedRecord()],
      permissionRequirements: [requirements],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      attentionReason: 'permission_required',
      defaultLaunchTarget: expect.objectContaining({ surfaceID: officialContainers.defaultSurfaceID }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', methods: ['containers.list'] }),
          expect.objectContaining({ permissionID: 'containers.execute', methods: ['containers.start'] }),
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
      defaultLaunchTarget: expect.objectContaining({ surfaceID: officialContainers.defaultSurfaceID }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'containers.read', granted: true, blockedByPolicy: true }),
        ]),
      },
    });
  });

  it('keeps the primary surface launchable when policy denies a non-opening read method', () => {
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
      defaultLaunchTarget: expect.objectContaining({ surfaceID: officialContainers.defaultSurfaceID }),
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
        action_state: {
          can_open: false,
          can_enable: false,
          can_disable: true,
          can_uninstall: true,
          blocked_reason: 'runtime_unavailable',
          recovery_action: 'retry',
        },
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
    expect(installedTile).toBeUndefined();
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
