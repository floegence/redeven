import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { applyOfficialDevelopmentDelivery, officialPluginCatalog, resolvePluginPresentation } from './officialPluginCatalog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';
import type { PluginDevelopmentDelivery } from './pluginTypes';

type CapabilityContract = {
  methods: Array<{
    name: string;
    required_permissions: string[];
  }>;
};

const containersCapabilityContract = JSON.parse(fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../../../spec/redevplugin/official-containers-capability-v4/bundle/capabilities/redeven.container_resources.v4/v4.0.0/redeven.container_resources.v4.schema.json',
  ),
  'utf8',
)) as CapabilityContract;

function methodsByPermissionFromContract(): Record<string, string[]> {
  const methodsByPermission = new Map<string, string[]>();
  for (const method of containersCapabilityContract.methods) {
    for (const permissionID of method.required_permissions) {
      const methods = methodsByPermission.get(permissionID) ?? [];
      methods.push(method.name);
      methodsByPermission.set(permissionID, methods);
    }
  }
  return Object.fromEntries(
    [...methodsByPermission.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([permissionID, methods]) => [permissionID, methods.sort()]),
  );
}

describe('official plugin catalog contracts', () => {
  it('loads the Containers icon from the immutable official plugin source', () => {
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]?.iconURL).toBe(
      'https://raw.githubusercontent.com/floegence/redeven-official-plugins/16429991dc3daa446385a933676b26c8031d3d7b/plugins/containers/assets/containers-plugin.png',
    );
  });

  it('keeps Containers permissions and methods aligned with the pinned capability contract', () => {
    const containersCatalogItem = OFFICIAL_PLUGIN_CATALOG_SEED.find(
      (item) => item.pluginID === 'com.redeven.official.containers',
    );
    expect(containersCatalogItem).toBeDefined();

    const catalogMethodsByPermission = Object.fromEntries(
      [...(containersCatalogItem?.permissions ?? [])]
        .sort((left, right) => left.permissionID.localeCompare(right.permissionID))
        .map((permission) => [permission.permissionID, [...permission.methods].sort()]),
    );

    expect(catalogMethodsByPermission).toEqual(methodsByPermissionFromContract());
  });

  it('projects the latest version from the current frozen market snapshot', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.generation = 2;
    next.plugins[0]!.latest.version = '4.1.0';
    next.plugins[0]!.release!.version = '4.1.0';
    next.plugins[0]!.release!.publisher_release_ref.release_ref.version = '4.1.0';

    expect(officialPluginCatalog(next)[0]).toMatchObject({
      latestVersion: '4.1.0',
      stableVersion: '4.1.0',
      distribution: {
        releaseRef: { version: '4.1.0' },
      },
    });
  });

  it('resolves the author presentation with RFC 4647 fallback', () => {
    const item = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
    expect(resolvePluginPresentation(item, 'zh-CN')).toMatchObject({
      resolved_locale: 'zh-CN',
      plugin_name: '容器',
      summary: '在 Redeven 中管理 Docker 和 Podman 资源。',
    });
    expect(resolvePluginPresentation(item, 'zh-TW-Hant')).toMatchObject({ resolved_locale: 'en-US' });
  });

  it('rejects development delivery metadata from any unpinned source identity', () => {
    const delivery: PluginDevelopmentDelivery = {
      plugin_instance_id: 'plugini_redeven_official_containers',
      publisher_id: 'com.redeven.official',
      plugin_id: 'com.redeven.official.containers',
      version: '4.0.0',
      package_url: '/_redeven_proxy/api/plugins/development-delivery/containers/package',
      package_sha256: 'a'.repeat(64),
      package_hash: 'sha256:package',
      manifest_hash: 'sha256:manifest',
      entries_hash: 'sha256:entries',
      capability_version: '3.0.0',
      release_notes_id: 'containers-4.0.0',
      release_notes_summary_sha256: 'b'.repeat(64),
      source_repository: 'https://github.com/example/untrusted-plugins.git',
      source_commit: 'b9eb04f6cc08eab35e0d0a8a5ac671ec5077aaed',
      development_only: true,
    };

    expect(() => applyOfficialDevelopmentDelivery(officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT), delivery)).toThrow(
      'Containers development delivery metadata is invalid',
    );
  });
});
