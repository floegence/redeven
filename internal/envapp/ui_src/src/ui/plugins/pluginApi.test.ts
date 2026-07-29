import { PluginTransportError, type PluginPlatformClient } from '@floegence/redevplugin-ui';
import type { PluginLocalImportClient } from '@floegence/redevplugin-ui/local-import';
import { describe, expect, it, vi } from 'vitest';

import { createPluginLifecycleAPI } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import type { ReDevPluginRecord } from './pluginTypes';

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];

function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async (): Promise<{ plugins: ReDevPluginRecord[] }> => ({ plugins: [] })),
    listPermissions: vi.fn(async () => ({ permissions: [] })),
    listSecurityPolicies: vi.fn(async () => ({ security_policies: [] })),
    installReleaseRef: vi.fn(async () => ({})),
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
      mocks as unknown as PluginPlatformClient, undefined, OFFICIAL_PLUGIN_CATALOG_SEED, async () => undefined,
    ),
  };
}

const developmentPackageBytes = new TextEncoder().encode('containers-development-package');
const developmentPackage = {
  arrayBuffer: async () => developmentPackageBytes.buffer.slice(0),
} as unknown as Blob;
const developmentPackageSHA256 = 'a90df057416662b93a9c1f9b0737d832198e3e6eb51fe54ba96619d69d622d0f';
const developmentDelivery = {
  plugin_instance_id: officialContainers.pluginInstanceID,
  publisher_id: officialContainers.publisherID,
  plugin_id: officialContainers.pluginID,
  version: '4.0.0',
  package_url: '/_redeven_proxy/api/plugins/development-delivery/containers/package',
  package_sha256: developmentPackageSHA256,
  package_hash: 'sha256:package',
  manifest_hash: 'sha256:manifest',
  entries_hash: 'sha256:entries',
  capability_version: '3.0.0',
  development_only: true as const,
};
const generatedContainersInstanceID = 'plugin_dea00daa09166c33302f92c9b090f62a';
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
    schema_version: 'redevplugin.manifest.v5',
    publisher: { publisher_id: officialContainers.publisherID, display_name: officialContainers.publisher },
    plugin: {
      plugin_id: officialContainers.pluginID, display_name: officialContainers.displayName,
      version: OFFICIAL_CONTAINERS_RELEASE_REF.version, api_version: 'plugin-v1',
      min_runtime_version: '0.6.5', ui_protocol_version: 'plugin-ui-v5',
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

describe('v0.6.7 plugin lifecycle client integration', () => {
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

  it('keeps a stale Containers development instance updateable when its old capability pin cannot be resolved', async () => {
    const { mocks } = createClientHarness();
    const staleDevelopmentRecord: ReDevPluginRecord = {
      ...generatedContainersRecord,
      version: developmentDelivery.version,
      trust_state: 'unsigned_local',
      package_hash: 'sha256:previous-development-package',
      manifest_hash: 'sha256:previous-development-manifest',
      entries_hash: 'sha256:previous-development-entries',
      management_revision: 29,
    };
    mocks.catalog.mockResolvedValue({ plugins: [staleDevelopmentRecord] });
    mocks.getPermissionRequirements.mockRejectedValue(new Error('old development capability pin is unavailable'));
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      { updateLocalPackage: vi.fn(async () => ({})) } as unknown as PluginLocalImportClient,
      OFFICIAL_PLUGIN_CATALOG_SEED,
      async () => developmentDelivery,
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [expect.objectContaining({
        pluginInstanceID: generatedContainersInstanceID,
        managementRevision: 29,
        lifecycleState: 'update_available',
      })],
    });
  });

  it('keeps permission requirement failures fatal outside the exact Containers development recovery path', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    mocks.getPermissionRequirements.mockRejectedValue(new Error('permission requirements unavailable'));

    await expect(lifecycle.loadInventoryProjection()).rejects.toThrow('permission requirements unavailable');
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

  it('updates the exact Containers instance from a hash-verified development package', async () => {
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    const updateLocalPackage = vi.fn(async () => ({}));
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      { updateLocalPackage } as unknown as PluginLocalImportClient,
      OFFICIAL_PLUGIN_CATALOG_SEED,
      async () => developmentDelivery,
    );
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => developmentPackage,
    })));
    try {
      await lifecycle.loadInventoryProjection();
      await lifecycle.execute({
        type: 'update',
        pluginID: officialContainers.pluginID,
        pluginInstanceID: generatedContainersInstanceID,
        expectedManagementRevision: 23,
        targetVersion: '4.0.0',
      });
      expect(updateLocalPackage).toHaveBeenCalledWith(
        generatedContainersInstanceID, 23, developmentPackage, { signal: undefined },
      );
      expect(mocks.updateReleaseRef).not.toHaveBeenCalled();

      await expect(lifecycle.execute({
        type: 'update',
        pluginID: officialContainers.pluginID,
        pluginInstanceID: 'plugini_other_instance',
        expectedManagementRevision: 23,
        targetVersion: '4.0.0',
      })).rejects.toThrow('development update target is invalid');
      await expect(lifecycle.execute({
        type: 'update',
        pluginID: officialContainers.pluginID,
        pluginInstanceID: generatedContainersInstanceID,
        expectedManagementRevision: 22,
        targetVersion: '4.0.0',
      })).rejects.toThrow('development update target is invalid');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a tampered Containers development package before local import', async () => {
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedContainersRecord] });
    const updateLocalPackage = vi.fn(async () => ({}));
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      { updateLocalPackage } as unknown as PluginLocalImportClient,
      OFFICIAL_PLUGIN_CATALOG_SEED,
      async () => developmentDelivery,
    );
    const tampered = new TextEncoder().encode('tampered');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => ({ arrayBuffer: async () => tampered.buffer.slice(0) }),
    })));
    try {
      await lifecycle.loadInventoryProjection();
      await expect(lifecycle.execute({
        type: 'update',
        pluginID: officialContainers.pluginID,
        pluginInstanceID: generatedContainersInstanceID,
        expectedManagementRevision: 23,
        targetVersion: '4.0.0',
      })).rejects.toThrow('package hash does not match');
      expect(updateLocalPackage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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
