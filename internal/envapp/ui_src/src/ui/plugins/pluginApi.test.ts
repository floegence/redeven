import {
  PluginTransportError,
  type PluginPlatformClient,
  type PluginReleaseInstallOperation,
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
    listPermissions: vi.fn(async () => ({ permissions: [] })),
    listSecurityPolicies: vi.fn(async () => ({ security_policies: [] })),
    installReleaseRef: vi.fn(async () => ({})),
    startReleaseInstallOperation: vi.fn(async () => releaseInstallOperation()),
    listReleaseInstallOperations: vi.fn(async (): Promise<{
      operations: PluginReleaseInstallOperation[];
    }> => ({ operations: [] })),
    getReleaseInstallOperationByRequest: vi.fn(async () => releaseInstallOperation()),
    watchReleaseInstallOperation: vi.fn(async () => releaseInstallOperation({
      status: 'succeeded',
      phase: 'complete',
      progress: { kind: 'items', completed: 1, total: 1 },
      mutation_outcome: 'committed',
    })),
    updateReleaseRef: vi.fn(async () => ({})),
    enablePlugin: vi.fn(async () => ({})),
    disablePlugin: vi.fn(async () => ({})),
    uninstallPlugin: vi.fn(async () => ({})),
    grantPermission: vi.fn(async () => ({})),
    revokePermission: vi.fn(async () => ({})),
    getPermissionRequirements: vi.fn(async ({ plugin_instance_id }: { plugin_instance_id: string }) => ({
      plugin_instance_id,
      required_permissions: [],
      contracts: [],
    })),
    inspectExternalPackage: vi.fn(async () => ({})),
    inspectUploadedExternalPackage: vi.fn(async () => ({})),
    commitExternalPackage: vi.fn(async () => ({})),
    queryExternalPackageCommit: vi.fn(async () => ({})),
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

function releaseInstallOperation(
  overrides: Partial<PluginReleaseInstallOperation> = {},
): PluginReleaseInstallOperation {
  return {
    request_id: releaseInstallRequestID,
    operation_id: 'release_install_4c9d48a3',
    plugin_instance_id: officialContainers.pluginInstanceID,
    request_sha256: 'a'.repeat(64),
    status: 'running',
    phase: 'download_package',
    progress: { kind: 'bytes', completed: 262_144, total: 524_288 },
    attempt: 1,
    retry_after_ms: 250,
    mutation_outcome: 'not_committed',
    created_at: '2026-08-05T08:00:00Z',
    updated_at: '2026-08-05T08:00:01Z',
    ...overrides,
  } as PluginReleaseInstallOperation;
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
    schema_version: 'redevplugin.manifest.v8',
    publisher: { publisher_id: officialContainers.publisherID, display_name: officialContainers.publisher },
    plugin: {
      plugin_id: officialContainers.pluginID, display_name: officialContainers.displayName,
      version: OFFICIAL_CONTAINERS_RELEASE_REF.version, api_version: 'plugin-v1',
      min_runtime_version: '0.6.5', ui_protocol_version: 'plugin-ui-v7',
    },
    presentation: {
      default_locale: 'en-US', summary: 'Containers plugin', description: ['Containers plugin.'], highlights: [], keywords: ['containers'], localizations: [],
    },
    surfaces: [{
      surface_id: officialContainers.defaultSurfaceID, kind: 'view', intent: 'primary',
      label: officialContainers.displayName, entry: 'ui/index.html',
    }],
  },
  package_entries: [],
  installed_at: '2026-07-04T10:00:00Z',
  updated_at: '2026-07-04T10:01:00Z',
};

describe('v0.7.16 plugin lifecycle client integration', () => {
  it('preserves the market detail generation from the local proxy envelope', async () => {
    vi.mocked(fetchLocalApiJSONResponse).mockResolvedValueOnce({
      data: { plugin_id: 'com.example.plugin', presentation: { default_locale: 'en-US', locales: [] } },
      meta: { generation: 41 },
      headers: new Headers(),
      status: 200,
    });

    await expect(loadPluginMarketDetail('com.example.plugin')).resolves.toMatchObject({
      plugin_id: 'com.example.plugin',
      generation: 41,
    });
    expect(fetchLocalApiJSONResponse).toHaveBeenCalledWith(
      '/_redeven_proxy/api/plugins/market/plugins/com.example.plugin',
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
        officialCatalog: expect.objectContaining({ latestVersion: '4.4.0' }),
      })],
    });
    expect(loadMarket).toHaveBeenCalledOnce();
  });

  it('keeps installed plugins visible when the market snapshot is unavailable', async () => {
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => { throw new Error('market unavailable'); },
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: true,
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        pluginID: 'com.redeven.official.containers',
      })],
    });
  });

  it('loads inventory exclusively through the platform catalog client', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.listInstalledPlugins()).resolves.toEqual([]);
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.catalog).toHaveBeenCalledWith({});
  });

  it('loads catalog before projecting grants, policies, and per-instance permission requirements', async () => {
    const { lifecycle, mocks } = createClientHarness();
    let releaseCatalog!: () => void;
    mocks.catalog.mockImplementation(() => new Promise((resolve) => {
      releaseCatalog = () => resolve({ plugins: [] });
    }));

    const loading = lifecycle.loadInventoryProjection();
    await Promise.resolve();

    expect(mocks.catalog).toHaveBeenCalledWith({});
    expect(mocks.listPermissions).not.toHaveBeenCalled();
    expect(mocks.listSecurityPolicies).not.toHaveBeenCalled();
    releaseCatalog();
    await expect(loading).resolves.toMatchObject({ items: expect.any(Array) });
    expect(mocks.listPermissions).toHaveBeenCalledWith({ active_only: true }, {});
    expect(mocks.listSecurityPolicies).toHaveBeenCalledWith({});
    expect(mocks.getPermissionRequirements).not.toHaveBeenCalled();
  });

  it('keeps permission requirement failures fatal', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    mocks.getPermissionRequirements.mockRejectedValue(new Error('permission requirements unavailable'));

    await expect(lifecycle.loadInventoryProjection()).rejects.toThrow('permission requirements unavailable');
  });

  it('starts and watches the generated signed release installation with one stable request id', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const updates: PluginReleaseInstallOperation[] = [];

    await expect(lifecycle.installOfficialRelease({
      type: 'install',
      pluginID: officialContainers.pluginID,
      source: 'official_catalog',
    }, releaseInstallRequestID, {}, (operation) => updates.push(operation))).resolves.toMatchObject({
      status: 'succeeded',
      mutation_outcome: 'committed',
    });

    expect(mocks.startReleaseInstallOperation).toHaveBeenCalledWith({
      request_id: releaseInstallRequestID,
      plugin_instance_id: officialContainers.pluginInstanceID,
      release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
    }, {});
    expect(mocks.watchReleaseInstallOperation).toHaveBeenCalledWith(
      'release_install_4c9d48a3',
      { onUpdate: expect.any(Function) },
    );
    expect(mocks.installReleaseRef).not.toHaveBeenCalled();
    expect(updates).toEqual([expect.objectContaining({ status: 'running' })]);
    expect(OFFICIAL_CONTAINERS_RELEASE_REF).toMatchObject({
      publisher_id: officialContainers.publisherID,
      plugin_id: officialContainers.pluginID,
      version: officialContainers.stableVersion,
    });
  });

  it('returns an already terminal release installation without starting a second watcher', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.startReleaseInstallOperation.mockResolvedValueOnce(releaseInstallOperation({
      status: 'failed',
      phase: 'failed',
      failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
    }));

    await expect(lifecycle.installOfficialRelease({
      type: 'install',
      pluginID: officialContainers.pluginID,
      source: 'official_catalog',
    }, releaseInstallRequestID)).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'PLUGIN_RELEASE_NETWORK', retryable: true },
    });
    expect(mocks.watchReleaseInstallOperation).not.toHaveBeenCalled();
  });

  it('lists and reattaches release installations through the published client helpers', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const operation = releaseInstallOperation();
    mocks.listReleaseInstallOperations.mockResolvedValueOnce({ operations: [operation] });
    mocks.getReleaseInstallOperationByRequest.mockResolvedValueOnce(operation);

    await expect(lifecycle.listReleaseInstallOperations()).resolves.toEqual([operation]);
    await expect(lifecycle.getReleaseInstallOperationByRequest(releaseInstallRequestID)).resolves.toEqual(operation);
    await expect(lifecycle.watchReleaseInstallOperation(operation.operation_id)).resolves.toMatchObject({
      status: 'succeeded',
    });

    expect(mocks.listReleaseInstallOperations).toHaveBeenCalledWith({});
    expect(mocks.getReleaseInstallOperationByRequest).toHaveBeenCalledWith(releaseInstallRequestID, {});
    expect(mocks.watchReleaseInstallOperation).toHaveBeenCalledWith(operation.operation_id, {});
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

  it('commits only the immutable server inspection id and confirmation digest', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_12345678',
      confirmation_digest: 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
    };
    const committed = { status: 'committed', inspection_id: inspection.inspection_id };
    mocks.commitExternalPackage.mockResolvedValue(committed);

    await expect(lifecycle.commitExternalPackage(inspection as never)).resolves.toBe(committed);

    expect(mocks.commitExternalPackage).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
      confirmation_digest: inspection.confirmation_digest,
    }, {});
    expect(mocks.queryExternalPackageCommit).not.toHaveBeenCalled();
  });

  it('queries an in-progress commit to its terminal result without repeating the mutation', async () => {
    vi.useFakeTimers();
    try {
      const { lifecycle, mocks } = createClientHarness();
      const inspection = {
        inspection_id: 'inspection_external_12345678',
        confirmation_digest: 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
      };
      const inProgress = {
        status: 'in_progress',
        inspection_id: inspection.inspection_id,
        intent: { action: 'install', plugin_instance_id: 'plugini_external_12345678' },
        retry_after_ms: 250,
      };
      const committed = { status: 'committed', inspection_id: inspection.inspection_id };
      mocks.commitExternalPackage.mockResolvedValue(inProgress);
      mocks.queryExternalPackageCommit.mockResolvedValue(committed);
      const onProgress = vi.fn();

      const result = lifecycle.commitExternalPackage(inspection as never, {}, onProgress);
      await Promise.resolve();
      expect(mocks.commitExternalPackage).toHaveBeenCalledOnce();
      expect(mocks.queryExternalPackageCommit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);

      await expect(result).resolves.toBe(committed);
      expect(mocks.commitExternalPackage).toHaveBeenCalledOnce();
      expect(mocks.queryExternalPackageCommit).toHaveBeenCalledWith({
        inspection_id: inspection.inspection_id,
      }, {});
      expect(onProgress).toHaveBeenNthCalledWith(1, inProgress);
      expect(onProgress).toHaveBeenNthCalledWith(2, committed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a timed-out in-progress reconciliation by query without repeating the mutation', async () => {
    vi.useFakeTimers();
    try {
      const { lifecycle, mocks } = createClientHarness();
      const inspection = {
        inspection_id: 'inspection_external_12345678',
        confirmation_digest: 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
      };
      const inProgress = {
        status: 'in_progress',
        inspection_id: inspection.inspection_id,
        intent: { action: 'install', plugin_instance_id: 'plugini_external_12345678' },
        retry_after_ms: 5_000,
      };
      mocks.commitExternalPackage.mockResolvedValue(inProgress);
      mocks.queryExternalPackageCommit.mockResolvedValue(inProgress);

      const result = lifecycle.commitExternalPackage(inspection as never);
      const rejection = expect(result).rejects.toThrow('reconciliation timed out');
      await vi.advanceTimersByTimeAsync(60_000);
      await rejection;
      expect(mocks.commitExternalPackage).toHaveBeenCalledOnce();
      expect(mocks.queryExternalPackageCommit.mock.calls.length).toBeGreaterThan(1);

      const committed = { status: 'committed', inspection_id: inspection.inspection_id };
      mocks.queryExternalPackageCommit.mockResolvedValue(committed);

      await expect(lifecycle.commitExternalPackage(inspection as never)).resolves.toBe(committed);
      expect(mocks.commitExternalPackage).toHaveBeenCalledOnce();
      expect(mocks.queryExternalPackageCommit).toHaveBeenLastCalledWith({
        inspection_id: inspection.inspection_id,
      }, {});
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles an unknown commit outcome by query instead of retrying the mutation', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_12345678',
      confirmation_digest: 'sha256:684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
    };
    const committed = { status: 'committed', inspection_id: inspection.inspection_id };
    mocks.commitExternalPackage.mockRejectedValue(new PluginTransportError(
      'response was lost after request transmission',
      new TypeError('network disconnected'),
      'unknown',
    ));
    mocks.queryExternalPackageCommit.mockResolvedValue(committed);

    await expect(lifecycle.commitExternalPackage(inspection as never)).resolves.toBe(committed);

    expect(mocks.commitExternalPackage).toHaveBeenCalledOnce();
    expect(mocks.queryExternalPackageCommit).toHaveBeenCalledOnce();
    expect(mocks.queryExternalPackageCommit).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
    }, {});
  });
});
