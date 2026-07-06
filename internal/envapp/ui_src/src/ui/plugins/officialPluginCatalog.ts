import type { OfficialPluginCatalogItem } from './pluginTypes';

export const OFFICIAL_PLUGIN_CATALOG_SEED: readonly OfficialPluginCatalogItem[] = Object.freeze([
  {
    pluginID: 'com.redeven.official.containers',
    displayName: 'Containers',
    description: "Manage Docker and Podman resources through Redeven's official container capability.",
    publisher: 'Redeven',
    latestVersion: '1.0.0',
    stableVersion: '1.0.0',
    minRedevenVersion: '0.1.0',
    minReDevPluginVersion: '0.1.1',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.activity',
    iconFallback: 'containers',
    distribution: {
      releaseChannel: 'github_release_and_redeven_cdn',
      artifactName: 'containers-1.0.0.redevplugin',
      officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
    },
  },
]);

export function officialPluginCatalog(): readonly OfficialPluginCatalogItem[] {
  return OFFICIAL_PLUGIN_CATALOG_SEED;
}
