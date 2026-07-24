import { PluginTransportError, type PluginPlatformClient } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { createPluginLifecycleAPI } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';

const officialContainers = OFFICIAL_PLUGIN_CATALOG_SEED[0];

function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async () => ({ plugins: [] })),
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
    lifecycle: createPluginLifecycleAPI(mocks as unknown as PluginPlatformClient),
  };
}

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
