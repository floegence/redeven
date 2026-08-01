import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import { applyOfficialDevelopmentDelivery, officialPluginCatalog } from './officialPluginCatalog';
import type { PluginDevelopmentDelivery, PluginMarketSnapshot } from './pluginTypes';

export const OFFICIAL_PLUGIN_MARKET_SNAPSHOT: PluginMarketSnapshot = {
  schema_version: 'redeven.plugin_market_snapshot.v1',
  generation: 1,
  etag: '"catalog-g1"',
  cached_at: '2026-08-01T10:00:00Z',
  stale: false,
  source: 'remote',
  plugins: [{
    plugin_id: 'com.redeven.official.containers',
    publisher_id: 'com.redeven.official',
    name: 'Containers',
    summary: 'Manage Docker and Podman resources through Redeven.',
    categories: ['containers', 'development'],
    channels: ['stable'],
    latest: { channel: 'stable', version: '4.0.1', availability_status: 'visible' },
    release: {
      plugin_id: 'com.redeven.official.containers',
      channel: 'stable',
      version: '4.0.1',
      asset: {
        url: 'https://github.com/floegence/redeven-official-plugins/releases/download/v4.0.1/containers-4.0.1.redevplugin',
      },
      publisher_release_ref: { release_ref: OFFICIAL_CONTAINERS_RELEASE_REF },
      signer_key_id: 'redeven_official_signing_2026',
      compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '0.6.23' },
    },
  }],
};

export const OFFICIAL_PLUGIN_CATALOG_SEED = officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);

export function officialPluginCatalogFixture(developmentDelivery?: PluginDevelopmentDelivery) {
  return developmentDelivery
    ? applyOfficialDevelopmentDelivery(OFFICIAL_PLUGIN_CATALOG_SEED, developmentDelivery)
    : OFFICIAL_PLUGIN_CATALOG_SEED;
}
