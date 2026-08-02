import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import { officialPluginCatalog } from './officialPluginCatalog';
import type { OfficialPluginPermission, PluginMarketSnapshot } from './pluginTypes';

export const OFFICIAL_PLUGIN_MARKET_SNAPSHOT: PluginMarketSnapshot = {
  schema_version: 'redeven.plugin_market_snapshot.v2',
  generation: 1,
  etag: '"catalog-g1"',
  cached_at: '2026-08-01T10:00:00Z',
  stale: false,
  source: 'remote',
  plugins: [{
    plugin_id: 'com.redeven.official.containers',
    publisher_id: 'com.redeven.official',
    presentation: {
      default_locale: 'en-US',
      locales: [
        {
          locale: 'en-US',
          name: 'Containers',
          publisher_name: 'Redeven Official',
          summary: 'Manage Docker and Podman resources through Redeven.',
          keywords: ['containers', 'Docker', 'Podman'],
        },
        {
          locale: 'zh-CN',
          name: '容器',
          publisher_name: 'Redeven 官方',
          summary: '在 Redeven 中管理 Docker 和 Podman 资源。',
          keywords: ['容器', 'Docker', 'Podman'],
        },
      ],
    },
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

const containersPermissionFixture: readonly OfficialPluginPermission[] = [
  {
    permissionID: 'containers.read',
    group: 'read',
    requiredToOpen: true,
    requiredToOpenMethods: ['containers.status', 'containers.list'],
    methods: ['containers.status', 'containers.list', 'containers.inspect'],
  },
  {
    permissionID: 'containers.execute',
    group: 'execute',
    requiredToOpen: false,
    methods: ['containers.start'],
  },
];

// Permission declarations are supplied by Host inventory in production. This
// fixture keeps projection tests focused on authorization state without making
// the catalog adapter own a plugin-specific permission table.
export const OFFICIAL_PLUGIN_CATALOG_SEED = officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT).map((item) => ({
  ...item,
  permissions: containersPermissionFixture,
}));
