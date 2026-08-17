import {
  type PluginExecution,
  type PluginPlatformClient,
} from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { fetchLocalApiJSONResponse } from '../services/localApi';
import { createPluginLifecycleAPI, loadPluginMarketDetail } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import type { ReDevPluginRecord } from './pluginTypes';

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: vi.fn(),
  fetchLocalApiJSONResponse: vi.fn(),
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];

function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async (): Promise<{ plugins: ReDevPluginRecord[] }> => ({ plugins: [] })),
    listPermissions: vi.fn(async (): ReturnType<PluginPlatformClient['listPermissions']> => ({ permissions: [] })),
    listSecurityPolicies: vi.fn(async (): ReturnType<PluginPlatformClient['listSecurityPolicies']> => ({ security_policies: [] })),
    installReleaseRef: vi.fn(async () => ({})),
    startReleaseInstallExecution: vi.fn(async () => releaseInstallExecution()),
    listExecutions: vi.fn(async () => ({ executions: [] as PluginExecution[] })),
    getExecution: vi.fn(async () => releaseInstallExecution()),
    listExecutionEvents: vi.fn(async () => ({ execution_id: 'release_install_4c9d48a3', events: [], cursor: 1 })),
    updateReleaseRef: vi.fn(async () => ({})),
    enablePlugin: vi.fn(async () => ({})),
    disablePlugin: vi.fn(async () => ({})),
    uninstallPlugin: vi.fn(async () => ({})),
    grantPermission: vi.fn(async () => ({})),
    revokePermission: vi.fn(async () => ({})),
    getPermissionRequirements: vi.fn(async ({ plugin_instance_id }: { plugin_instance_id: string }): ReturnType<PluginPlatformClient['getPermissionRequirements']> => ({
      plugin_instance_id,
      plugin_version: OFFICIAL_CONTAINERS_RELEASE_REF.version,
      active_fingerprint: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.package_sha256,
      management_revision: 23,
      required_permissions: [],
      contracts: [],
    })),
    inspectReleasePackage: vi.fn(async () => ({
      plugin_instance_id: officialContainers.pluginInstanceID,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
      inspected_hashes: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes,
      presentation: generatedContainersRecord.presentation,
      presentation_sha256: 'sha256:' + 'a'.repeat(64),
      security_summary: {
        summary_sha256: 'sha256:' + 'b'.repeat(64),
        permissions: [{ permission_id: 'containers.read', methods: ['containers.list'], required: true, effects: ['read'] }],
        methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [],
      },
    })),
    inspectExternalPackage: vi.fn(async () => ({})),
    inspectUploadedExternalPackage: vi.fn(async () => ({})),
    installInspectedPackage: vi.fn(async () => ({})),
    recoverEnabled: vi.fn(async () => ({ revision: 1, complete: true, results: [] })),
    retryRecovery: vi.fn(async () => ({ plugin_instance_id: officialContainers.pluginInstanceID, status: 'ready' as const })),
  };
  return {
    mocks,
    lifecycle: createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient, OFFICIAL_PLUGIN_CATALOG_SEED,
    ),
  };
}

const generatedContainersInstanceID = 'plugin_dea00daa09166c33302f92c9b090f62a';
const releaseInstallRequestID = '996224cb-c992-4fc3-b74a-9a100f306da4';

function releaseInstallExecution(
  overrides: Partial<PluginExecution> = {},
): PluginExecution {
  return {
    execution_id: 'release_install_4c9d48a3',
    plugin_instance_id: officialContainers.pluginInstanceID,
    kind: 'operation',
    status: 'completed',
    cursor: 1,
    cancelable: false,
    created_at: '2026-08-05T08:00:00Z',
    updated_at: '2026-08-05T08:00:01Z',
    terminal_at: '2026-08-05T08:00:01Z',
    ...overrides,
  };
}
const generatedContainersRecord: ReDevPluginRecord = {
  plugin_instance_id: generatedContainersInstanceID,
  publisher_id: officialContainers.publisherID,
  plugin_id: officialContainers.pluginID,
  version: OFFICIAL_CONTAINERS_RELEASE_REF.version,
  active_fingerprint: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.package_sha256,
  package_hash: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.package_sha256,
  manifest_hash: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.manifest_sha256,
  entries_hash: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.entries_sha256,
  trust_state: 'untrusted',
  trust_assessment: {
    trust_state: 'untrusted',
    verified_hashes: {
      package_sha256: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.package_sha256,
      manifest_sha256: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.manifest_sha256,
      entries_sha256: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.entries_sha256,
    },
  },
  enable_state: 'enabled',
  policy_revision: 3,
  management_revision: 23,
  revoke_epoch: 0,
  manifest: {
    schema_version: 'redevplugin.manifest.v9',
    publisher: { publisher_id: officialContainers.publisherID, display_name: officialContainers.publisher },
    plugin: {
      plugin_id: officialContainers.pluginID, display_name: officialContainers.displayName,
      version: OFFICIAL_CONTAINERS_RELEASE_REF.version,
    },
    api: { surface: 1, worker: 1 },
    permissions: [],
    presentation: { locales: { default: 'en-US' } },
    surfaces: [{
      surface_id: officialContainers.defaultSurfaceID, kind: 'view', intent: 'primary',
      label: officialContainers.displayName, entry: 'ui/index.html',
    }],
    workers: [],
    methods: [],
  },
  package_entries: [],
  installed_at: '2026-07-04T10:00:00Z',
  updated_at: '2026-07-04T10:01:00Z',
};

describe('v1.1.4 plugin lifecycle client integration', () => {
  it('loads an installed package icon without blocking the first inventory projection', async () => {
    const { mocks } = createClientHarness();
    const iconDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const iconPath = 'ui/assets/containers.png';
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...generatedContainersRecord,
        manifest: {
          ...generatedContainersRecord.manifest,
          presentation: { ...generatedContainersRecord.manifest.presentation, icon: { path: iconPath } },
        },
        package_entries: [{
          path: iconPath,
          size: 123,
          sha256: iconDigest,
          mode: '0644',
          content_type: 'image/png',
        }],
      }],
    });
    const loadInstalledIcon = vi.fn(async () => 'blob:redeven-installed-icon');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      OFFICIAL_PLUGIN_CATALOG_SEED,
      undefined,
      loadInstalledIcon,
    );

    const initialProjection = await lifecycle.loadInventoryProjection();
    await Promise.resolve();
    const enrichedProjection = await lifecycle.loadInventoryProjection();

    expect(loadInstalledIcon).toHaveBeenCalledWith(
      `/_redevplugin/api/plugins/${encodeURIComponent(generatedContainersInstanceID)}/icon/${iconDigest.slice(7)}`,
      expect.any(AbortSignal),
    );
    expect(initialProjection.items.find((item) => item.pluginInstanceID === generatedContainersInstanceID)?.iconURL)
      .toBeUndefined();
    expect(enrichedProjection.items.find((item) => item.pluginInstanceID === generatedContainersInstanceID)?.iconURL)
      .toBe('blob:redeven-installed-icon');
    expect(loadInstalledIcon).toHaveBeenCalledOnce();

    lifecycle.dispose();

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:redeven-installed-icon');
  });

  it('publishes installed inventory immediately when icon decoding does not settle', async () => {
    const { mocks } = createClientHarness();
    const iconDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const iconPath = 'ui/assets/containers.png';
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...generatedContainersRecord,
        manifest: {
          ...generatedContainersRecord.manifest,
          presentation: { ...generatedContainersRecord.manifest.presentation, icon: { path: iconPath } },
        },
        package_entries: [{
          path: iconPath,
          size: 123,
          sha256: iconDigest,
          mode: '0644',
          content_type: 'image/png',
        }],
      }],
    });
    const loadInstalledIcon = vi.fn(() => new Promise<string>(() => {}));
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      OFFICIAL_PLUGIN_CATALOG_SEED,
      undefined,
      loadInstalledIcon,
    );

    const projection = await lifecycle.loadInventoryProjection();

    expect(projection).toMatchObject({
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        iconURL: undefined,
      })],
    });
    lifecycle.dispose();
  });

  it('keeps an enabled registry record visible when lifecycle metadata reads fail', async () => {
    const { mocks, lifecycle } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    mocks.listPermissions.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));
    mocks.listSecurityPolicies.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));
    mocks.getPermissionRequirements.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));

    const projection = await lifecycle.loadInventoryProjection();
    const installed = projection.items.find((item) => item.pluginInstanceID === generatedContainersInstanceID);
    expect(installed).toMatchObject({
      pluginInstanceID: generatedContainersInstanceID,
      lifecycleState: 'needs_attention',
      attentionReason: 'diagnostic_error',
    });
    expect(installed?.lifecycleState).not.toBe('not_installed');
  });

  it('fails closed when the Host action state is absent', async () => {
    const { mocks, lifecycle } = createClientHarness();
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...generatedContainersRecord,
        trust_state: 'verified',
        trust_assessment: {
          ...generatedContainersRecord.trust_assessment,
          trust_state: 'verified',
        },
      }],
    });
    mocks.listPermissions.mockResolvedValue({
      permissions: [{
        plugin_instance_id: generatedContainersInstanceID,
        permission_id: 'containers.read',
        effect: 'grant',
        granted_at: '2026-08-12T16:13:36Z',
      }],
    });
    mocks.listSecurityPolicies.mockResolvedValue({
      security_policies: [{
        plugin_instance_id: generatedContainersInstanceID,
        allowed_permissions: ['containers.read'],
        denied_methods: [],
        policy_revision: 3,
        management_revision: 23,
        revoke_epoch: 0,
        updated_at: '2026-08-12T16:13:36Z',
      }],
    });
    mocks.getPermissionRequirements.mockResolvedValue({
      plugin_instance_id: generatedContainersInstanceID,
      plugin_version: OFFICIAL_CONTAINERS_RELEASE_REF.version,
      active_fingerprint: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes.package_sha256,
      management_revision: 23,
      required_permissions: ['containers.read'],
      contracts: [],
    });

    const projection = await lifecycle.loadInventoryProjection();
    expect(projection.items).toEqual([
      expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        lifecycleState: 'enabled',
        defaultLaunchTarget: undefined,
      }),
    ]);
    expect(mocks.listPermissions).toHaveBeenCalledOnce();
    expect(mocks.listSecurityPolicies).toHaveBeenCalledOnce();
    expect(mocks.getPermissionRequirements).toHaveBeenCalledOnce();
  });

  it('preserves the market detail generation from the local proxy envelope', async () => {
    vi.mocked(fetchLocalApiJSONResponse).mockResolvedValueOnce({
      data: { plugin_id: 'com.example.plugin', presentation: { default_locale: 'en-US', locales: [] } },
      meta: { generation: 41 },
      headers: new Headers(),
      status: 200,
    });

    await expect(loadPluginMarketDetail('com.example.plugin', 41)).resolves.toMatchObject({
      plugin_id: 'com.example.plugin',
      generation: 41,
    });
    expect(fetchLocalApiJSONResponse).toHaveBeenCalledWith(
      '/_redeven_proxy/api/plugins/market/plugins/com.example.plugin?generation=41',
      expect.anything(),
    );
  });

  it('loads the official catalog from the frozen same-origin market snapshot', async () => {
    const { mocks } = createClientHarness();
    const loadMarket = vi.fn(async () => OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      loadMarket,
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginID: 'com.redeven.official.containers',
        lifecycleState: 'not_installed',
        officialCatalog: expect.objectContaining({ latestVersion: '4.4.4' }),
      })],
    });
    expect(loadMarket).toHaveBeenCalledOnce();
  });

  it('projects installed plugins without waiting for the market snapshot', async () => {
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => { throw new Error('market unavailable'); },
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        pluginID: 'com.redeven.official.containers',
      })],
    });
  });

  it('projects installed plugins without waiting for an unresponsive market snapshot', async () => {
    vi.useFakeTimers();
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      () => new Promise(() => {}),
    );

    const loading = lifecycle.loadInventoryProjection();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(loading).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        pluginID: 'com.redeven.official.containers',
      })],
    });
    vi.useRealTimers();
  });

  it('loads inventory exclusively through the platform catalog client', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.listInstalledPlugins()).resolves.toEqual([]);
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.catalog).toHaveBeenCalledWith({});
  });

  it('reads the Host-owned enabled plugin recovery snapshot', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.recoverEnabled()).resolves.toEqual({ revision: 1, complete: true, results: [] });
    expect(mocks.recoverEnabled).toHaveBeenCalledOnce();
    expect(mocks.recoverEnabled).toHaveBeenCalledWith({});
  });

  it('loads catalog before projecting grants, policies, and per-instance permission requirements', async () => {
    const { lifecycle, mocks } = createClientHarness();
    let releaseCatalog!: () => void;
    mocks.catalog.mockImplementation(() => new Promise((resolve) => {
      releaseCatalog = () => resolve({ plugins: [generatedContainersRecord] });
    }));

    const loading = lifecycle.loadInventoryProjection();
    await Promise.resolve();

    expect(mocks.catalog).toHaveBeenCalledWith({});
    expect(mocks.listPermissions).not.toHaveBeenCalled();
    expect(mocks.listSecurityPolicies).not.toHaveBeenCalled();
    releaseCatalog();
    await expect(loading).resolves.toMatchObject({ items: expect.any(Array) });
    expect(mocks.listPermissions).toHaveBeenCalledWith(
      { active_only: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.listSecurityPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.getPermissionRequirements).toHaveBeenCalledWith(
      { plugin_instance_id: generatedContainersInstanceID },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps the installed record when permission requirements are unavailable', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    mocks.getPermissionRequirements.mockRejectedValue(new Error('permission requirements unavailable'));

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        lifecycleState: 'needs_attention',
        attentionReason: 'diagnostic_error',
      })],
    });
  });

  it('starts the generated signed release installation with one stable request id', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const updates: PluginExecution[] = [];

    await expect(lifecycle.installOfficialRelease({
      type: 'install',
      pluginID: officialContainers.pluginID,
      source: 'official_catalog',
    }, releaseInstallRequestID, {}, (execution) => updates.push(execution))).resolves.toMatchObject({
      status: 'completed',
    });

    expect(mocks.startReleaseInstallExecution).toHaveBeenCalledWith({
      request_id: releaseInstallRequestID,
      plugin_instance_id: officialContainers.pluginInstanceID,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
      activate_after_install: true,
    }, {});
    expect(mocks.installReleaseRef).not.toHaveBeenCalled();
    expect(updates).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(OFFICIAL_CONTAINERS_RELEASE_REF).toMatchObject({
      publisher_id: officialContainers.publisherID,
      plugin_id: officialContainers.pluginID,
      version: officialContainers.stableVersion,
    });
  });

  it('inspects the exact official release before installation review', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.inspectOfficialRelease(officialContainers.pluginID)).resolves.toMatchObject({
      plugin_instance_id: officialContainers.pluginInstanceID,
      security_summary: {
        permissions: [{ permission_id: 'containers.read' }],
      },
    });

    expect(mocks.inspectReleasePackage).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
    }, {});
  });

  it('returns an already terminal release installation execution', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.startReleaseInstallExecution.mockResolvedValueOnce(releaseInstallExecution({
      status: 'failed',
      failure_code: 'PLUGIN_RELEASE_NETWORK',
    }));

    await expect(lifecycle.installOfficialRelease({
      type: 'install',
      pluginID: officialContainers.pluginID,
      source: 'official_catalog',
    }, releaseInstallRequestID)).resolves.toMatchObject({
      status: 'failed',
      failure_code: 'PLUGIN_RELEASE_NETWORK',
    });
    expect(mocks.listExecutionEvents).not.toHaveBeenCalled();
  });

  it('lists and reads release installation executions through the unified client helpers', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const execution = releaseInstallExecution();
    mocks.listExecutions.mockResolvedValueOnce({ executions: [execution] });
    mocks.getExecution.mockResolvedValueOnce(execution);

    await expect(lifecycle.listReleaseInstallExecutions()).resolves.toEqual([execution]);
    await expect(lifecycle.getReleaseInstallExecution(execution.execution_id)).resolves.toEqual(execution);
    await expect(lifecycle.listReleaseInstallExecutionEvents(execution.execution_id, 0)).resolves.toMatchObject({ cursor: 1 });

    expect(mocks.listExecutions).toHaveBeenCalledWith({ limit: 100 }, {});
    expect(mocks.getExecution).toHaveBeenCalledWith(execution.execution_id, {});
    expect(mocks.listExecutionEvents).toHaveBeenCalledWith(execution.execution_id, { after_cursor: 0 }, {});
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

  it('treats an already-enabled PluginRecord as the authoritative idempotent result', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValueOnce({ plugins: [generatedContainersRecord] });

    await expect(lifecycle.authorizeAndEnablePlugin(
      generatedContainersInstanceID,
      ['containers.read', 'containers.execute'],
    )).resolves.toMatchObject({
      plugin_instance_id: generatedContainersInstanceID,
      enable_state: 'enabled',
    });

    expect(mocks.enablePlugin).not.toHaveBeenCalled();
    expect(mocks.grantPermission).not.toHaveBeenCalled();
    expect(mocks.getPermissionRequirements).not.toHaveBeenCalled();
  });

  it('binds grant and revoke mutations to the exact authorization revisions', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const revisions = {
      expectedPolicyRevision: 11,
      expectedManagementRevision: 17,
      expectedRevokeEpoch: 4,
    };

    await lifecycle.execute({
      type: 'grant_permission',
      pluginInstanceID: officialContainers.pluginInstanceID,
      permissionID: 'containers.read',
      ...revisions,
    });
    await lifecycle.execute({
      type: 'revoke_permission',
      pluginInstanceID: officialContainers.pluginInstanceID,
      permissionID: 'containers.execute',
      ...revisions,
    });

    expect(mocks.grantPermission).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      permission_id: 'containers.read',
      expected_policy_revision: 11,
      expected_management_revision: 17,
      expected_revoke_epoch: 4,
    }, {});
    expect(mocks.revokePermission).toHaveBeenCalledWith({
      plugin_instance_id: officialContainers.pluginInstanceID,
      permission_id: 'containers.execute',
      expected_policy_revision: 11,
      expected_management_revision: 17,
      expected_revoke_epoch: 4,
      reason: 'user_revoked',
    }, {});
  });

  it('maps package URL and GitHub selections to closed platform inspection requests', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const signal = new AbortController().signal;
    await lifecycle.inspectExternalPackage({
      sourceKind: 'package_url',
      url: 'https://plugins.example.com/toolbox.redevplugin',
      intent: { action: 'install' },
    }, { signal });
    await lifecycle.inspectExternalPackage({
      sourceKind: 'github_repository',
      url: 'https://github.com/example/toolbox',
      tag: ' v1.2.3 ',
      intent: {
        action: 'update',
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
    }, { signal });

    expect(mocks.inspectExternalPackage).toHaveBeenNthCalledWith(1, {
      intent: { action: 'install' },
      source: { kind: 'package_url', url: 'https://plugins.example.com/toolbox.redevplugin' },
    }, { signal });
    expect(mocks.inspectExternalPackage).toHaveBeenNthCalledWith(2, {
      intent: {
        action: 'update',
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
      source: { kind: 'github_repository', url: 'https://github.com/example/toolbox', tag: 'v1.2.3' },
    }, { signal });
  });

  it('passes uploaded packages through the dedicated binary inspection API', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const file = new File(['package'], 'toolbox.redevplugin', { type: 'application/vnd.redevplugin.package+zip' });
    const signal = new AbortController().signal;
    const intent = {
      action: 'update' as const,
      plugin_instance_id: 'plugini_external_12345678',
      expected_management_revision: 9,
    };

    await lifecycle.inspectExternalPackage({ sourceKind: 'package_upload', file, intent }, { signal });

    expect(mocks.inspectUploadedExternalPackage).toHaveBeenCalledWith(intent, file, { signal });
    expect(mocks.inspectExternalPackage).not.toHaveBeenCalled();
  });

  it('installs a fresh inspection with its exact digest and the confirmed activation intent', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_12345678',
      inspected_hashes: {
        package_sha256: '684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
        manifest_sha256: '1'.repeat(64),
        entries_sha256: '2'.repeat(64),
      },
      intent: { action: 'install' as const },
      security_summary: {
        permissions: [
          { permission_id: 'containers.read', methods: ['containers.list'] },
          { permission_id: 'containers.execute', methods: ['containers.start'] },
        ],
      },
    };
    const installed = { plugin: { plugin_instance_id: 'plugini_external_12345678' } };
    mocks.installInspectedPackage.mockResolvedValue(installed);

    await expect(lifecycle.installExternalPackage(inspection as never)).resolves.toBe(installed);

    expect(mocks.installInspectedPackage).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
      expected_package_sha256: inspection.inspected_hashes.package_sha256,
      activate_after_install: true,
      approved_permission_ids: ['containers.read', 'containers.execute'],
    }, {});
  });

  it('commits an external update without changing its enable intent or adding grants', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_update_12345678',
      inspected_hashes: {
        package_sha256: '684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
      },
      intent: {
        action: 'update' as const,
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
      security_summary: {
        permissions: [{ permission_id: 'workspace.read', methods: ['workspace.list'] }],
      },
    };

    await lifecycle.installExternalPackage(inspection as never);

    expect(mocks.installInspectedPackage).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
      expected_package_sha256: inspection.inspected_hashes.package_sha256,
    }, {});
  });
});
