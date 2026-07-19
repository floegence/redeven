import type { PluginPlatformClient, PluginRequestOptions } from '@floegence/redevplugin-ui';

import { officialPluginCatalog } from './officialPluginCatalog';
import { projectPluginInventory } from './pluginInventoryProjection';
import type {
  OfficialPluginCatalogItem,
  PluginInventoryProjection,
  PluginManagementCommand,
  ReDevPluginRecord,
} from './pluginTypes';

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  catalog: readonly OfficialPluginCatalogItem[] = officialPluginCatalog(),
) {
  const officialByPluginID = new Map(catalog.map((item) => [item.pluginID, item]));

  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const loadInventoryProjection = async (options: PluginRequestOptions = {}): Promise<PluginInventoryProjection> => projectPluginInventory({
    officialCatalog: catalog,
    installedPlugins: await listInstalledPlugins(options),
  });

  const execute = async (
    command: PluginManagementCommand,
    options: PluginRequestOptions = {},
  ): Promise<ReDevPluginRecord> => {
    switch (command.type) {
      case 'install': {
        const official = requireOfficialPlugin(officialByPluginID, command.pluginID);
        return client.installReleaseRef({
          plugin_instance_id: official.pluginInstanceID,
          release_ref: official.distribution.releaseRef,
        }, options);
      }
      case 'enable':
        return client.enablePlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
        }, options);
      case 'disable':
        return client.disablePlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          reason: 'user_disabled',
        }, options);
      case 'uninstall':
        return client.uninstallPlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          delete_data: command.dataRetention === 'delete_data',
        }, options);
      case 'update': {
        const official = requireOfficialPlugin(officialByPluginID, command.pluginID);
        if (command.targetVersion !== official.distribution.releaseRef.version) {
          throw new Error('Official plugin update target does not match its signed release reference');
        }
        return client.updateReleaseRef({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          release_ref: official.distribution.releaseRef,
        }, options);
      }
      default:
        return assertNever(command);
    }
  };

  return Object.freeze({ listInstalledPlugins, loadInventoryProjection, execute });
}

function requireOfficialPlugin(
  catalog: ReadonlyMap<string, OfficialPluginCatalogItem>,
  pluginID: string,
): OfficialPluginCatalogItem {
  const item = catalog.get(pluginID);
  if (!item) {
    throw new Error('Official plugin release is unavailable');
  }
  return item;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported plugin lifecycle command: ${JSON.stringify(value)}`);
}
