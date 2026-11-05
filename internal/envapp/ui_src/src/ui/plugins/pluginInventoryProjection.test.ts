import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog.test-fixture';
import {
  buildPluginCenterModel,
  buildPluginPanelModel,
  projectPluginInventory,
} from './pluginInventoryProjection';
import type { ReDevPluginRecord } from './pluginTypes';
import type { PluginPermissionRequirements } from '@floegence/redevplugin-ui';

const examplePlugin = OFFICIAL_PLUGIN_CATALOG_SEED[0];
function installedRequirements(pluginInstanceID = examplePlugin.pluginInstanceID): PluginPermissionRequirements {
  return { plugin_instance_id: pluginInstanceID, plugin_version: examplePlugin.stableVersion,
    active_fingerprint: packageHash, management_revision: 7, required_permissions: ['metrics.read'],
    contracts: [{ contract_id: 'example.metrics.v1', contract_version: '4.0.0', contract_sha256: 'a'.repeat(64),
      capability_id: 'example.capability.metrics', capability_version: '3.0.0',
      methods: [{ method: 'metrics.list', required_permissions: ['metrics.read'] }, { method: 'metrics.inspect', required_permissions: ['metrics.read'] }] }] };
}

const packageHash = examplePlugin.installPreview!.release.package_sha256;
const manifestHash = examplePlugin.installPreview!.release.manifest_sha256;
const entriesHash = examplePlugin.installPreview!.release.entries_sha256;
const otherPackageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
const readGrant = {
  plugin_instance_id: examplePlugin.pluginInstanceID,
  permission_id: 'metrics.read',
  effect: 'grant',
  granted_at: '2026-07-04T10:02:00Z',
} as const;
function installedRecord(overrides: Partial<ReDevPluginRecord> = {}): ReDevPluginRecord {
  const marketIcon = examplePlugin.presentation?.icon;
  const iconPath = 'ui/assets/metrics-plugin.png';
  return {
    plugin_instance_id: examplePlugin.pluginInstanceID,
    publisher_id: examplePlugin.publisherID,
    plugin_id: examplePlugin.pluginID,
    version: examplePlugin.stableVersion,
    active_fingerprint: packageHash,
    package_hash: packageHash,
    manifest_hash: manifestHash,
    entries_hash: entriesHash,
    automatic_updates: false,
    source_provenance: { kind: 'github_repository', repository_id: '1289352675', release_id: '21', asset_id: '22', repository_url: 'https://github.com/example/example-plugins', owner: 'example', repository: 'example-plugins', resolved_commit_sha: 'a'.repeat(40), release_tag: 'metrics-v4.4.9', asset_name: 'metrics-4.4.9.redevplugin', package_sha256: packageHash, resolved_at: '2026-11-05T00:00:00Z' },
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
        publisher_id: examplePlugin.publisherID,
        display_name: examplePlugin.publisher,
      },
      plugin: {
        plugin_id: examplePlugin.pluginID,
        display_name: examplePlugin.displayName,
        version: examplePlugin.stableVersion,
      },
      api: { major: 1 },
      permissions: [],
      presentation: { locales: { default: 'en-US' }, icon: { path: iconPath } },
      surfaces: [
        {
          surface_id: 'metrics.dashboard',
          kind: 'view',
          intent: 'primary',
          label: examplePlugin.displayName,
          entry: 'ui/index.html', web: { root: 'ui', spa: false },
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

describe('plugin inventory projection', () => {
  it('does not label method-only grants as necessary to open an independent surface', () => {
    const record = installedRecord();
    record.manifest.surfaces[0].required_methods = [];
    const item = projectPluginInventory({ officialCatalog: [], installedPlugins: [record], permissionRequirements: [installedRequirements()] }).items[0];
    expect(item.authorization?.permissions[0]).toMatchObject({ permissionID: 'metrics.read', requiredToOpen: false });
  });
  it('preserves the Host installation identity in official and generic inventory', () => {
    const record = installedRecord();
    const expected = {
      plugin_instance_id: record.plugin_instance_id,
      active_fingerprint: record.active_fingerprint,
      installed_at: record.installed_at,
      management_revision: record.management_revision,
      enable_state: record.enable_state,
      deleted_at: record.deleted_at,
    };
    for (const officialCatalog of [[], [examplePlugin]]) {
      expect(projectPluginInventory({ officialCatalog, installedPlugins: [record] }).items[0].recoveryIdentity).toEqual(expected);
    }
    expect(projectPluginInventory({ officialCatalog: [examplePlugin], installedPlugins: [] }).items[0].recoveryIdentity).toBeUndefined();
  });

  it('uses current interval state instead of a stale background diagnostic while retaining separate process status', () => {
    const record = installedRecord({ background_interval: { state: 'scheduled', interval_ms: 60000, max_runtime_ms: 5000, last_outcome: 'success' } });
    for (const officialCatalog of [[], [examplePlugin]]) {
      const project = (eventType: string) => projectPluginInventory({ officialCatalog, installedPlugins: [record], processStatusByInstanceID: new Map([[record.plugin_instance_id, { state: 'crashed', eventType }]]) }).items[0];
      expect(project('plugin.background.failed').processStatus).toBeUndefined();
      expect(project('plugin.process.operation_failed').processStatus?.state).toBe('crashed');
    }
  });

  it.each(['scheduled', 'running', 'stopped', 'blocked'] as const)('preserves authoritative %s interval status in official and generic inventory', (state) => {
    const background_interval = { state, interval_ms: 60000, max_runtime_ms: 5000, last_outcome: 'unknown' as const, next_run_at: '2026-10-31T10:00:00Z' };
    for (const officialCatalog of [[], [examplePlugin]]) {
      const [item] = projectPluginInventory({ officialCatalog, installedPlugins: [installedRecord({ background_interval })] }).items;
      expect(item.backgroundInterval).toEqual(background_interval);
      const baseline = projectPluginInventory({ officialCatalog, installedPlugins: [installedRecord()] }).items[0];
      expect(item.lifecycleState).toBe(baseline.lifecycleState);
    }
    expect(projectPluginInventory({ officialCatalog: [], installedPlugins: [installedRecord()] }).items[0].backgroundInterval).toBeUndefined();
  });

  it('keeps Plugin Center as the first panel tile', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [],
    });

    const panel = buildPluginPanelModel(projection);
    expect(panel.tiles[0]).toMatchObject({ kind: 'open_center', id: 'plugin-center' });
    expect(panel.tiles).toHaveLength(1);
  });

  it('joins the registry record only by exact publisher, plugin, and instance identity', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      pluginID: examplePlugin.pluginID,
      pluginInstanceID: examplePlugin.pluginInstanceID,
      displayName: examplePlugin.displayName,
      iconURL: `/_redevplugin/api/plugins/${encodeURIComponent(examplePlugin.pluginInstanceID)}/icon/${examplePlugin.presentation?.icon?.sha256}`,
      lifecycleState: 'enabled',
      sourceKind: 'official',
      managementRevision: 7,
      defaultLaunchTarget: {
        pluginID: examplePlugin.pluginID,
        pluginInstanceID: examplePlugin.pluginInstanceID,
        surfaceID: 'metrics.dashboard',
        expectedManagementRevision: 7,
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
      officialCatalog: [examplePlugin],
      installedPlugins: [blockedByHost],
      permissionGrants: [readGrant],
    });

    const item = projection.items[0];
    expect(item?.defaultLaunchTarget).toBeUndefined();
    expect(buildPluginPanelModel(projection).tiles).toHaveLength(1);
    expect(buildPluginCenterModel(projection).installed[0]?.defaultLaunchTarget).toBeUndefined();
  });

  it('does not invent a launch surface when the verified manifest has no primary view', () => {
    const installed = installedRecord({
      manifest: { ...installedRecord().manifest, surfaces: [] },
    });
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installed],
      permissionGrants: [readGrant],
    });

    expect(projection.items[0]?.defaultLaunchTarget).toBeUndefined();
    expect(buildPluginPanelModel(projection).tiles).toHaveLength(1);
  });

  it('uses an installed package icon URL without a market catalog', () => {
    const iconPath = 'ui/assets/metrics-plugin.png';
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
      `/_redevplugin/api/plugins/${encodeURIComponent(examplePlugin.pluginInstanceID)}/icon/${iconDigest.slice(7)}`,
    );
  });

  it('uses an installed package icon URL even when the market release identity differs', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord({
        version: examplePlugin.stableVersion,
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

    const installed = projection.items.find((item) => item.pluginInstanceID === examplePlugin.pluginInstanceID);
    expect(installed?.iconURL).toContain('/_redevplugin/api/plugins/');
    expect(installed?.iconURL).toContain('/icon/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('uses the content-addressed installed icon when an older release binds the same bytes', () => {
    const marketIcon = examplePlugin.presentation?.icon;
    expect(marketIcon).toBeDefined();
    const iconPath = 'ui/assets/metrics-plugin.png';
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
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

    const installed = projection.items.find((item) => item.pluginInstanceID === examplePlugin.pluginInstanceID);
    expect(installed?.iconURL).toBe(
      `/_redevplugin/api/plugins/${encodeURIComponent(examplePlugin.pluginInstanceID)}/icon/${marketIcon!.sha256}`,
    );
  });

  it('rejects an installed icon entry with an unsupported media type', () => {
    const iconPath = 'ui/assets/metrics-plugin.png';
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
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

    const installed = projection.items.find((item) => item.pluginInstanceID === examplePlugin.pluginInstanceID);
    expect(installed?.iconURL).toBeUndefined();
  });

  it('does not project market author copy into an installed record without presentation', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord({
        manifest: {
          ...installedRecord().manifest,
          publisher: {
            publisher_id: examplePlugin.publisherID,
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
      pluginInstanceID: examplePlugin.pluginInstanceID,
      displayName: examplePlugin.pluginID,
      description: examplePlugin.pluginID,
      publisher: 'Installed Publisher',
      searchKeywords: [],
      defaultLaunchTarget: {
        displayName: examplePlugin.pluginID,
      },
    });
    expect(projection.items[0]?.description).not.toBe(examplePlugin.description);
  });

  const catalogPresentationMismatchCases: Array<{
    label: string;
    overrides: Partial<ReDevPluginRecord>;
  }> = [
    {
      label: 'package hash mismatch from a different source',
      overrides: {
        source_provenance: undefined,
        active_fingerprint: otherPackageHash,
        package_hash: otherPackageHash,
      },
    },
    {
      label: 'version mismatch',
      overrides: {
        version: '1.9.0',
        source_provenance: {
          kind: 'package_url' as const,
          source_origin: 'https://plugins.example.com',
          source_path: '/metrics-1.9.0.redevplugin',
          redirect_chain: [],
          package_sha256: packageHash,
          resolved_at: '2026-07-24T10:00:00Z',
        },
      },
    },
    {
      label: 'older version from an unassociated source',
      overrides: {
        source_provenance: undefined,
        version: '1.9.0',
      },
    },
  ];

  it.each(catalogPresentationMismatchCases)('does not let a same-identity $label inherit official catalog presentation', ({ overrides }) => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord(overrides)],
    });

    expect(projection.items).toHaveLength(2);
    const catalogItem = projection.items.find((item) => item.inventoryKey.startsWith('catalog:'));
    const externalItem = projection.items.find((item) => item.inventoryKey.startsWith('instance:'));
    expect(catalogItem).toMatchObject({
      displayName: examplePlugin.displayName,
      sourceKind: 'official',
      lifecycleState: 'not_installed',
    });
    expect(externalItem).toMatchObject({
      inventoryKey: `instance:${examplePlugin.pluginInstanceID}`,
      pluginInstanceID: examplePlugin.pluginInstanceID,
    });
    expect(externalItem).not.toHaveProperty('officialCatalog');
  });

  it('binds the original repository to its generated installed instance', () => {
    const pluginInstanceID = 'plugin_generated_metrics';
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements(pluginInstanceID)],
      installedPlugins: [installedRecord({
        plugin_instance_id: pluginInstanceID,
        execution_approval: {
          state: 'user_approved',
          reason_codes: [],
          assessed_at: '2026-07-24T10:00:00Z',
          approved_at: '2026-07-24T10:01:00Z',
        },
        enable_state: 'disabled_by_user',
        enabled_at: undefined,
      })],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      inventoryKey: `instance:${pluginInstanceID}`,
      pluginInstanceID,
      displayName: examplePlugin.displayName,
      sourceKind: 'official',
      lifecycleState: 'disabled',
      officialCatalog: { pluginID: examplePlugin.pluginID },
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'metrics.read', requiredToOpen: true }),
        ]),
      },
    });
    expect(buildPluginCenterModel(projection, 'installed').discover).toHaveLength(0);
  });

  it('keeps a mismatched publisher separate while binding exact catalog content from any generated instance', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [
        installedRecord({ publisher_id: 'com.example.publisher' }),
        installedRecord({ plugin_instance_id: 'plugini_different_instance' }),
      ],
    });

    expect(projection.items).toHaveLength(2);
    const catalogItem = projection.items.find((item) => item.inventoryKey === 'instance:plugini_different_instance');
    expect(catalogItem).toMatchObject({
      pluginID: examplePlugin.pluginID,
      pluginInstanceID: 'plugini_different_instance',
      officialCatalog: { pluginID: examplePlugin.pluginID },
    });
    expect(projection.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        inventoryKey: `instance:${examplePlugin.pluginInstanceID}`,
        publisher: examplePlugin.publisher,
      }),
      expect.objectContaining({
        inventoryKey: 'instance:plugini_different_instance',
        pluginID: examplePlugin.pluginID,
      }),
    ]));
  });

  it('keeps installed records that are not matched by the official catalog in the inventory union', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
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
        pluginID: examplePlugin.pluginID,
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

  it('routes only enabled verified records with a revision-bound launch target', () => {
    const enabledProjection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
    });
    const disabledProjection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord({
        enable_state: 'disabled_by_user',
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
      officialCatalog: [examplePlugin],
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
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements()],
      installedPlugins: [installedRecord()],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      attentionReason: undefined,
      defaultLaunchTarget: expect.objectContaining({ surfaceID: 'metrics.dashboard' }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'metrics.read', granted: false }),
        ]),
      },
    });
  });

  it('projects Host-verified requirements when the market catalog has no permission metadata', () => {
    const requirements: PluginPermissionRequirements = {
      plugin_instance_id: examplePlugin.pluginInstanceID,
      plugin_version: examplePlugin.stableVersion,
      active_fingerprint: packageHash,
      management_revision: 7,
      required_permissions: ['metrics.read', 'metrics.execute'],
      contracts: [{
        contract_id: 'example.metrics.v1',
        contract_version: '4.0.0',
        contract_sha256: 'a'.repeat(64),
        capability_id: 'example.capability.metrics',
        capability_version: '3.0.0',
        methods: [
          { method: 'metrics.list', required_permissions: ['metrics.read'] },
          { method: 'metrics.start', required_permissions: ['metrics.execute'] },
        ],
      }],
    };
    const projection = projectPluginInventory({
      officialCatalog: [{ ...examplePlugin, permissions: [] }],
      installedPlugins: [installedRecord()],
      permissionRequirements: [requirements],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      attentionReason: undefined,
      defaultLaunchTarget: expect.objectContaining({ surfaceID: 'metrics.dashboard' }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({ permissionID: 'metrics.read', methods: ['metrics.list'] }),
          expect.objectContaining({ permissionID: 'metrics.execute', methods: ['metrics.start'] }),
        ]),
      },
    });
  });

  it('keeps an explicit deny distinct from a missing grant', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements()],
      installedPlugins: [installedRecord()],
      permissionGrants: [{ ...readGrant, effect: 'deny' }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      attentionReason: undefined,
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({
            permissionID: 'metrics.read',
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
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements()],
      installedPlugins: [installedRecord()],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: examplePlugin.pluginInstanceID,
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
          expect.objectContaining({ permissionID: 'metrics.read', blockedByPolicy: false }),
        ]),
      },
    });
  });

  it.each([
    {
      allowed_permissions: ['metrics.execute'],
      denied_methods: [],
    },
    {
      allowed_permissions: [],
      denied_methods: ['metrics.list'],
    },
  ])('marks the required read permission as policy restricted for %#', (policyRules) => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements()],
      installedPlugins: [installedRecord({ action_state: { can_open: false, can_enable: false, can_disable: true, can_uninstall: true, blocked_reason: 'policy_restricted' } })],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: examplePlugin.pluginInstanceID,
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
          expect.objectContaining({ permissionID: 'metrics.read', granted: true, blockedByPolicy: true }),
        ]),
      },
    });
  });

  it('keeps the primary surface launchable when policy denies a non-opening read method', () => {
    const record = installedRecord();
    record.manifest.surfaces[0].required_methods = ['metrics.list'];
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      permissionRequirements: [installedRequirements()],
      installedPlugins: [record],
      permissionGrants: [readGrant],
      securityPolicies: [{
        plugin_instance_id: examplePlugin.pluginInstanceID,
        allowed_permissions: [],
        denied_methods: ['metrics.inspect'],
        policy_revision: 8,
        management_revision: 7,
        revoke_epoch: 0,
        updated_at: '2026-07-04T10:03:00Z',
      }],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'enabled',
      attentionReason: undefined,
      defaultLaunchTarget: expect.objectContaining({ surfaceID: 'metrics.dashboard' }),
      authorization: {
        permissions: expect.arrayContaining([
          expect.objectContaining({
            permissionID: 'metrics.read',
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
      officialCatalog: [{ ...examplePlugin, rolloutState: 'revoked' }],
      installedPlugins: [],
    });

    expect(projection.items[0]).toMatchObject({
      lifecycleState: 'needs_attention',
      sourceKind: 'official',
      attentionReason: 'catalog_revoked',
    });
  });

  it('keeps Host-unavailable records out of open flows', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord({
        action_state: {
          can_open: false,
          can_enable: false,
          can_disable: true,
          can_uninstall: true,
          blocked_reason: 'runtime_unavailable',
          recovery_action: 'retry',
        },
      })],
    });

    const installedItem = projection.items.find((item) => item.inventoryKey.startsWith('instance:'));
    expect(installedItem).toMatchObject({
      lifecycleState: 'needs_attention',
      sourceKind: 'official',
      attentionReason: 'runtime_missing',
      defaultLaunchTarget: undefined,
    });
    const installedTile = buildPluginPanelModel(projection, undefined, { canOpenSurfaces: true }).tiles
      .find((tile) => tile.kind === 'plugin' && tile.item.inventoryKey.startsWith('instance:'));
    expect(installedTile).toBeUndefined();
  });

  it('builds installed and update buckets from the typed registry record', () => {
    const projection = projectPluginInventory({
      officialCatalog: [examplePlugin],
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
      officialCatalog: [examplePlugin],
      installedPlugins: [installedRecord({ version: '2.0.0-rc.1' })],
    });

    expect(projection.items[0]).toMatchObject({ lifecycleState: 'update_available' });
    expect(buildPluginCenterModel(projection, 'updates').updates).toHaveLength(1);
  });

  it.each(['v2.0.0', ' 2.0.0', '2.0.0 ', '02.0.0'])(
    'rejects a non-canonical plugin version %j',
    (version) => {
      expect(() => projectPluginInventory({
        officialCatalog: [examplePlugin],
        installedPlugins: [installedRecord({ version })],
      })).toThrow('canonical strict SemVer');
    },
  );
});

it('retains every Host-verified view surface as a restoration target without replacing the original with the default', () => {
  const record = installedRecord();
  record.manifest.surfaces.push({ ...record.manifest.surfaces[0], surface_id: 'secondary', intent: 'secondary' });
  const projection = projectPluginInventory({ officialCatalog: [examplePlugin], installedPlugins: [record] });
  const item = projection.items.find((item) => item.pluginInstanceID === record.plugin_instance_id)!;
  expect(item.declaredSurfaceIDs).toEqual(['metrics.dashboard', 'secondary']);
  expect(item.launchTargets?.find((target) => target.surfaceID === 'secondary')).toMatchObject({
    pluginInstanceID: record.plugin_instance_id, expectedManagementRevision: 7,
  });
  expect(item.defaultLaunchTarget?.surfaceID).toBe('metrics.dashboard');
  const disabled = projectPluginInventory({ officialCatalog: [examplePlugin], installedPlugins: [{ ...record, action_state: { ...record.action_state!, can_open: false } }] });
  expect(disabled.items.find((item) => item.pluginInstanceID === record.plugin_instance_id)?.launchTargets).toEqual([]);
});

it('projects connector capabilities only from verified installed declarations', () => {
  const record = installedRecord();
  record.manifest.network_access = { connectors: [{ connector_id: 'service', transport: 'http', configurable: true, scope: 'environment', destinations: [] }] };
  record.manifest.methods = [{ method: 'fetch', effect: 'read', execution: 'sync', route: { kind: 'surface', surface_id: 'metrics.dashboard' },
    broker_access: { network: [{ connector_id: 'service', transport: 'http', operations: ['http'], http_methods: ['GET'] }] }, request_schema: { type: 'object', additionalProperties: false }, response_schema: { type: 'object', additionalProperties: false } }];
  record.manifest.surfaces[0].web!.network = [{ connector_id: 'service', transport: 'http', operations: ['http'], http_methods: ['GET', 'POST'] }];
  for (const officialCatalog of [[], [examplePlugin]]) {
    const projected = projectPluginInventory({ officialCatalog, installedPlugins: [record] }).items.find((item) => item.pluginInstanceID === record.plugin_instance_id)!;
    expect(projected.networkConnectors).toEqual([{ connectorID: 'service', transport: 'http', configurable: true, httpMethods: ['GET', 'POST'] }]);
  }
  expect(projectPluginInventory({ officialCatalog: [examplePlugin], installedPlugins: [] }).items[0].networkConnectors).toBeUndefined();
});

it('does not let market availability revoke an already installed package', () => {
  const projection = projectPluginInventory({
    officialCatalog: [{ ...examplePlugin, rolloutState: 'revoked' }],
    installedPlugins: [installedRecord()], permissionGrants: [readGrant],
  });
  expect(projection.items[0]).toMatchObject({ lifecycleState: 'enabled', sourceKind: 'official' });
});

it('never derives installed permissions from a newer market release', () => {
  const projection = projectPluginInventory({ officialCatalog: [{ ...examplePlugin, permissions: [{ permissionID: 'market.admin', group: 'other', requiredToOpen: true, methods: ['market.delete'] }] }], installedPlugins: [installedRecord()], permissionRequirements: [installedRequirements()] });
  expect(projection.items[0]?.authorization?.permissions.map((item) => item.permissionID)).toEqual(['metrics.read']);
});

it('selects only individually authorized surfaces from Host inventory', () => {
  const record = installedRecord();
  record.manifest.surfaces.push({ ...record.manifest.surfaces[0]!, surface_id: 'public', intent: 'secondary' });
  record.action_state = { can_open: true, can_enable: false, can_disable: true, can_uninstall: true, surfaces: [{ surface_id: 'metrics.dashboard', can_open: false, blocked_reason: 'permission_required' }, { surface_id: 'public', can_open: true }] };
  const item = projectPluginInventory({ officialCatalog: [examplePlugin], installedPlugins: [record] }).items[0]!;
  expect(item.launchTargets?.map((target) => target.surfaceID)).toEqual(['public']);
  expect(item.defaultLaunchTarget?.surfaceID).toBe('public');
});
