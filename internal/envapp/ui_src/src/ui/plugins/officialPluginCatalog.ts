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
    minReDevPluginVersion: '0.5.1',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.dashboard',
    iconFallback: 'containers',
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
    },
  },
]);

export function officialPluginCatalog(): readonly OfficialPluginCatalogItem[] {
  return OFFICIAL_PLUGIN_CATALOG_SEED;
}
