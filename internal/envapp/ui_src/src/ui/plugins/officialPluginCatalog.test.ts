import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED, officialPluginCatalog } from './officialPluginCatalog';
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
    '../../../spec/redevplugin/official-containers-capability/capabilities/redeven.container_resources.v2/v2.0.0/redeven.container_resources.v2.schema.json',
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
      'https://raw.githubusercontent.com/floegence/redeven-official-plugins/37d4dfff0cfa88c7a00ee0b89f55bfbcdde4b251/plugins/containers/assets/containers-plugin.png',
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
      source_commit: '37d4dfff0cfa88c7a00ee0b89f55bfbcdde4b251',
      development_only: true,
    };

    expect(() => officialPluginCatalog(delivery)).toThrow(
      'Containers development delivery metadata is invalid',
    );
  });
});
