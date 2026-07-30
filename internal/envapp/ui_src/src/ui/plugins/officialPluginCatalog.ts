import type { OfficialPluginCatalogItem } from './pluginTypes';
import containersPluginIconURL from '../../../../../../plugins/official/containers/assets/containers-plugin.png';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import officialContainersDistribution from './officialContainersDistribution.json';
import { officialReleaseNotes } from './pluginReleaseNotes';

export const OFFICIAL_CONTAINERS_PACKAGE_URL =
  `https://raw.githubusercontent.com/${officialContainersDistribution.repository}/${officialContainersDistribution.commit}/${officialContainersDistribution.artifact_path.join('/')}`;

export const OFFICIAL_PLUGIN_CATALOG_SEED: readonly OfficialPluginCatalogItem[] = Object.freeze([
  {
    pluginID: 'com.redeven.official.containers',
    publisherID: 'com.redeven.official',
    pluginInstanceID: 'plugini_redeven_official_containers',
    displayName: 'Containers',
    description: "Manage Docker and Podman resources through Redeven's official container capability.",
    publisher: 'Redeven',
    latestVersion: '2.0.0',
    stableVersion: '2.0.0',
    minRedevenVersion: '0.9.0',
    minReDevPluginVersion: '0.6.5',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.dashboard',
    defaultSurfaceDisplayNameKey: 'uiCopy.plugin.containersDashboardSurface',
    iconURL: containersPluginIconURL,
    iconFallback: 'containers',
    category: 'infrastructure',
    searchKeywords: ['container', 'docker', 'podman', 'image', 'volume', 'runtime'],
    searchAliasesKey: 'uiCopy.plugin.containersSearchAliases',
    trustedSigningKeyIDs: ['redeven-official-signing-2026'],
    permissions: [
      {
        permissionID: 'containers.read',
        group: 'read',
        requiredToOpen: true,
        methods: ['containers.status', 'containers.list', 'containers.inspect', 'containers.start.preflight', 'containers.logs.tail'],
        requiredToOpenMethods: ['containers.status', 'containers.list'],
      },
      {
        permissionID: 'containers.execute',
        group: 'execute',
        requiredToOpen: false,
        methods: ['containers.start', 'containers.stop', 'containers.restart'],
      },
      {
        permissionID: 'containers.delete',
        group: 'delete',
        requiredToOpen: false,
        methods: ['containers.remove'],
      },
      {
        permissionID: 'containers.images.write',
        group: 'images_write',
        requiredToOpen: false,
        methods: ['images.pull'],
      },
    ],
    releaseNotes: officialReleaseNotes('com.redeven.official.containers', OFFICIAL_CONTAINERS_RELEASE_REF),
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
      installSource: {
        sourceKind: 'package_url',
        url: OFFICIAL_CONTAINERS_PACKAGE_URL,
      },
    },
  },
]);

export function officialPluginCatalog(developmentDelivery?: import('./pluginTypes').PluginDevelopmentDelivery): readonly OfficialPluginCatalogItem[] {
  if (!developmentDelivery) return OFFICIAL_PLUGIN_CATALOG_SEED;
  const containers = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
  if (developmentDelivery.plugin_id !== containers.pluginID
    || developmentDelivery.publisher_id !== containers.publisherID
    || developmentDelivery.plugin_instance_id !== containers.pluginInstanceID
    || developmentDelivery.version !== '4.0.0'
    || developmentDelivery.capability_version !== '3.0.0'
    || developmentDelivery.development_only !== true) {
    throw new Error('Containers development delivery metadata is invalid');
  }
  return Object.freeze([{
    ...containers,
    latestVersion: developmentDelivery.version,
    stableVersion: developmentDelivery.version,
    distribution: {
      ...containers.distribution,
      developmentDelivery,
    },
  }]);
}
