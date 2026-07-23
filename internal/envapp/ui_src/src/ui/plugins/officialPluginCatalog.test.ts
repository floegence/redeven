import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog';

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
});
