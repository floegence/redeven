import type {
  OfficialPluginCatalogItem,
  OfficialPluginPermission,
  PluginDevelopmentDelivery,
  PluginMarketSnapshot,
  PluginPresentationCategory,
} from './pluginTypes';

const OFFICIAL_CONTAINERS_PLUGIN_ID = 'com.redeven.official.containers';
const OFFICIAL_PUBLISHER_ID = 'com.redeven.official';
const OFFICIAL_CONTAINERS_SOURCE_REPOSITORY = 'https://github.com/floegence/redeven-official-plugins.git';
const OFFICIAL_CONTAINERS_SOURCE_COMMIT = '16429991dc3daa446385a933676b26c8031d3d7b';
const OFFICIAL_CONTAINERS_DEVELOPMENT_SOURCE_COMMIT = 'b9eb04f6cc08eab35e0d0a8a5ac671ec5077aaed';
const OFFICIAL_CONTAINERS_ICON_URL =
  `https://raw.githubusercontent.com/floegence/redeven-official-plugins/${OFFICIAL_CONTAINERS_SOURCE_COMMIT}/plugins/containers/assets/containers-plugin.png`;

const containersPermissions: readonly OfficialPluginPermission[] = Object.freeze([
  {
    permissionID: 'containers.read',
    group: 'read',
    requiredToOpen: true,
    requiredToOpenMethods: ['containers.status', 'containers.list'],
    methods: [
      'containers.status', 'containers.list', 'containers.inspect', 'containers.start.preflight',
      'containers.logs.tail', 'containers.stats.snapshot', 'containers.stats.watch', 'images.list',
      'images.inspect', 'images.history', 'volumes.list', 'volumes.inspect', 'endpoints.list',
      'endpoints.status', 'compose.projects.list', 'compose.projects.inspect',
      'compose.projects.action.preflight', 'pods.list', 'pods.inspect', 'pods.create.preflight',
      'pods.action.preflight',
    ],
  },
  {
    permissionID: 'containers.execute',
    group: 'execute',
    requiredToOpen: false,
    methods: [
      'containers.start', 'containers.stop', 'containers.restart', 'containers.create.preflight',
      'containers.create', 'containers.pause', 'containers.unpause', 'containers.kill',
      'volumes.create.preflight', 'volumes.create', 'compose.projects.start',
      'compose.projects.stop', 'compose.projects.restart', 'pods.create', 'pods.start',
      'pods.stop', 'pods.restart',
    ],
  },
  {
    permissionID: 'containers.delete',
    group: 'delete',
    requiredToOpen: false,
    methods: [
      'containers.remove', 'containers.remove.preflight', 'images.remove.preflight', 'images.remove',
      'images.prune.preflight', 'images.prune', 'volumes.remove.preflight', 'volumes.remove',
      'volumes.prune.preflight', 'volumes.prune', 'compose.projects.down', 'pods.remove',
    ],
  },
  {
    permissionID: 'containers.images.write',
    group: 'images_write',
    requiredToOpen: false,
    methods: ['images.pull', 'images.tag'],
  },
]);

export function officialPluginCatalog(
  snapshot?: PluginMarketSnapshot,
  developmentDelivery?: PluginDevelopmentDelivery,
): readonly OfficialPluginCatalogItem[] {
  const catalog = snapshot ? projectMarketSnapshot(snapshot) : [];
  return developmentDelivery ? applyOfficialDevelopmentDelivery(catalog, developmentDelivery) : Object.freeze(catalog);
}

export function applyOfficialDevelopmentDelivery(
  catalog: readonly OfficialPluginCatalogItem[],
  developmentDelivery: PluginDevelopmentDelivery,
): readonly OfficialPluginCatalogItem[] {
  validateDevelopmentDelivery(developmentDelivery);
  const containers = catalog.find((item) => item.pluginID === OFFICIAL_CONTAINERS_PLUGIN_ID);
  if (!containers) return Object.freeze(catalog);
  return Object.freeze(catalog.map((item) => item === containers ? {
    ...item,
    latestVersion: developmentDelivery.version,
    stableVersion: developmentDelivery.version,
    distribution: { ...item.distribution, developmentDelivery },
  } : item));
}

function projectMarketSnapshot(snapshot: PluginMarketSnapshot): OfficialPluginCatalogItem[] {
  if (snapshot.schema_version !== 'redeven.plugin_market_snapshot.v1'
    || !Number.isSafeInteger(snapshot.generation)
    || snapshot.generation < 0
    || !Array.isArray(snapshot.plugins)) {
    throw new Error('Plugin market snapshot metadata is invalid');
  }
  return snapshot.plugins.flatMap((plugin) => {
    if (plugin.publisher_id !== OFFICIAL_PUBLISHER_ID
      || plugin.plugin_id !== OFFICIAL_CONTAINERS_PLUGIN_ID
      || plugin.latest.channel !== 'stable'
      || plugin.release?.plugin_id !== plugin.plugin_id
      || plugin.release.channel !== plugin.latest.channel
      || plugin.release.version !== plugin.latest.version) return [];
    const releaseRef = plugin.release.publisher_release_ref.release_ref;
    if (releaseRef.publisher_id !== plugin.publisher_id
      || releaseRef.plugin_id !== plugin.plugin_id
      || releaseRef.channel !== plugin.latest.channel
      || releaseRef.version !== plugin.latest.version) return [];
    return [{
      pluginID: plugin.plugin_id,
      publisherID: plugin.publisher_id,
      pluginInstanceID: 'plugini_redeven_official_containers',
      displayName: plugin.name,
      description: plugin.summary,
      publisher: 'Redeven' as const,
      latestVersion: plugin.latest.version,
      stableVersion: plugin.latest.version,
      minRedevenVersion: plugin.release.compatibility.min_redeven_version,
      minReDevPluginVersion: plugin.release.compatibility.min_redevplugin_version,
      rolloutState: marketRolloutState(plugin.latest.availability_status),
      defaultSurfaceID: 'containers.dashboard',
      defaultSurfaceDisplayNameKey: 'uiCopy.plugin.containersDashboardSurface' as const,
      iconURL: OFFICIAL_CONTAINERS_ICON_URL,
      iconFallback: 'containers' as const,
      category: marketCategory(plugin.categories),
      searchKeywords: ['container', 'docker', 'podman', 'image', 'volume', 'runtime'],
      searchAliasesKey: 'uiCopy.plugin.containersSearchAliases' as const,
      trustedSigningKeyIDs: [plugin.release.signer_key_id],
      permissions: containersPermissions,
      distribution: {
        releaseRef,
        installSource: { sourceKind: 'package_url' as const, url: plugin.release.asset.url },
      },
    }];
  });
}

function marketRolloutState(status: 'visible' | 'disabled' | 'revoked'): OfficialPluginCatalogItem['rolloutState'] {
  if (status === 'visible') return 'stable';
  return status;
}

function marketCategory(categories: readonly string[]): PluginPresentationCategory {
  if (categories.includes('development')) return 'development';
  if (categories.includes('containers') || categories.includes('infrastructure')) return 'infrastructure';
  return 'other';
}

function validateDevelopmentDelivery(delivery: PluginDevelopmentDelivery): void {
  if (delivery.plugin_id !== OFFICIAL_CONTAINERS_PLUGIN_ID
    || delivery.publisher_id !== OFFICIAL_PUBLISHER_ID
    || delivery.plugin_instance_id !== 'plugini_redeven_official_containers'
    || delivery.version !== '4.0.0'
    || delivery.capability_version !== '3.0.0'
    || delivery.source_repository !== OFFICIAL_CONTAINERS_SOURCE_REPOSITORY
    || delivery.source_commit !== OFFICIAL_CONTAINERS_DEVELOPMENT_SOURCE_COMMIT
    || delivery.development_only !== true) {
    throw new Error('Containers development delivery metadata is invalid');
  }
}
