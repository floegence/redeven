import type { OfficialPluginCatalogItem } from './pluginTypes';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';

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
    iconFallback: 'containers',
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
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
    },
  },
]);

export function officialPluginCatalog(): readonly OfficialPluginCatalogItem[] {
  return OFFICIAL_PLUGIN_CATALOG_SEED;
}
