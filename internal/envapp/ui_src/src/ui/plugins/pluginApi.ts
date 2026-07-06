import { fetchLocalApiJSON } from '../services/localApi';
import { officialPluginPackage } from './officialPluginPackages';
import { projectPluginInventory } from './pluginInventoryProjection';
import type {
  PluginInventoryProjection,
  PluginLifecycleCommand,
  PluginOpenSurfaceResult,
  PluginSurfaceLaunchTarget,
  ReDevPluginCatalogResult,
  ReDevPluginRecord,
} from './pluginTypes';

const pluginAPIBase = '/_redeven_proxy/api/plugins';

export async function listInstalledPlugins(): Promise<ReDevPluginRecord[]> {
  const result = await fetchLocalApiJSON<ReDevPluginCatalogResult>(`${pluginAPIBase}/catalog`, { method: 'GET' });
  return Array.isArray(result.plugins) ? result.plugins : [];
}

export async function loadPluginInventoryProjection(): Promise<PluginInventoryProjection> {
  return projectPluginInventory({ installedPlugins: await listInstalledPlugins() });
}

export const pluginLifecycleApi = {
  enable(pluginInstanceID: string): Promise<ReDevPluginRecord> {
    return fetchLocalApiJSON<ReDevPluginRecord>(`${pluginAPIBase}/enable`, {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: pluginInstanceID }),
    });
  },
  disable(pluginInstanceID: string): Promise<ReDevPluginRecord> {
    return fetchLocalApiJSON<ReDevPluginRecord>(`${pluginAPIBase}/disable`, {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: pluginInstanceID, reason: 'user_disabled' }),
    });
  },
  uninstall(pluginInstanceID: string, dataRetention: 'keep_data' | 'delete_data'): Promise<ReDevPluginRecord> {
    return fetchLocalApiJSON<ReDevPluginRecord>(`${pluginAPIBase}/uninstall`, {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: pluginInstanceID, delete_data: dataRetention === 'delete_data' }),
    });
  },
  installOfficial(pluginID: string): Promise<ReDevPluginRecord> {
    const pkg = requireOfficialPackage(pluginID);
    return fetchLocalApiJSON<ReDevPluginRecord>(`${pluginAPIBase}/install`, {
      method: 'POST',
      body: JSON.stringify({
        package_base64: pkg.packageBase64,
        trust_state: 'bundled',
      }),
    });
  },
  updateOfficial(pluginID: string, pluginInstanceID: string): Promise<ReDevPluginRecord> {
    const pkg = requireOfficialPackage(pluginID);
    return fetchLocalApiJSON<ReDevPluginRecord>(`${pluginAPIBase}/update`, {
      method: 'POST',
      body: JSON.stringify({
        plugin_instance_id: pluginInstanceID,
        package_base64: pkg.packageBase64,
        trust_state: 'bundled',
      }),
    });
  },
  openSurface(target: PluginSurfaceLaunchTarget): Promise<PluginOpenSurfaceResult> {
    return fetchLocalApiJSON<PluginOpenSurfaceResult>(`${pluginAPIBase}/surfaces/open`, {
      method: 'POST',
      body: JSON.stringify({ plugin_instance_id: target.pluginInstanceID, surface_id: target.surfaceID }),
    });
  },
};

export async function executePluginLifecycleCommand(command: PluginLifecycleCommand): Promise<unknown> {
  switch (command.type) {
    case 'enable':
      return pluginLifecycleApi.enable(command.pluginInstanceID);
    case 'disable':
      return pluginLifecycleApi.disable(command.pluginInstanceID);
    case 'uninstall':
      return pluginLifecycleApi.uninstall(command.pluginInstanceID, command.dataRetention);
    case 'update':
      return pluginLifecycleApi.updateOfficial(command.pluginID, command.pluginInstanceID);
    case 'open_surface':
      return pluginLifecycleApi.openSurface({
        pluginInstanceID: command.pluginInstanceID,
        surfaceID: command.surfaceID,
        preferredPlacement: command.placement,
      });
    case 'install':
      return pluginLifecycleApi.installOfficial(command.pluginID);
    default:
      return assertNever(command);
  }
}

function requireOfficialPackage(pluginID: string) {
  const pkg = officialPluginPackage(pluginID);
  if (!pkg) {
    throw new Error(`Official bundled package is unavailable for ${pluginID}`);
  }
  return pkg;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported plugin lifecycle command: ${JSON.stringify(value)}`);
}
