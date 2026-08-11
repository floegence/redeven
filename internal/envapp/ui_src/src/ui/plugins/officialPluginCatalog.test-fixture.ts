import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import { officialPluginCatalog } from './officialPluginCatalog';
import type { OfficialPluginPermission, PluginMarketDetail, PluginMarketSnapshot } from './pluginTypes';

export const OFFICIAL_PLUGIN_MARKET_SNAPSHOT: PluginMarketSnapshot = {
  schema_version: 'redeven.plugin_market_snapshot.v2',
  generation: 5,
  etag: '"catalog-g5"',
  cached_at: '2026-08-07T10:00:00Z',
  stale: false,
  source: 'remote',
  plugins: [{
    plugin_id: 'com.redeven.official.containers',
    publisher_id: 'com.redeven.official',
    presentation: {
      default_locale: 'en-US',
      icon: {
        url: '/v1/plugins/com.redeven.official.containers/icon?sha256=949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1',
        media_type: 'image/png',
        width: 512,
        height: 512,
        sha256: '949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1',
      },
      locales: [
        {
          locale: 'de-DE',
          name: 'Container',
          publisher_name: 'Redeven Offiziell',
          summary: 'Verwalte Docker- und Podman-Container, Images, Volumes, Protokolle und Statistiken in einem fokussierten Arbeitsbereich.',
          keywords: ['Container', 'Docker', 'Podman', 'Images', 'Volumes', 'Protokolle', 'Statistiken', 'Bereinigung'],
        },
        {
          locale: 'en-US',
          name: 'Containers',
          publisher_name: 'Redeven Official',
          summary: 'Manage Docker and Podman containers, images, volumes, logs, and statistics in one focused workspace.',
          keywords: ['containers', 'Docker', 'Podman', 'images', 'volumes', 'logs', 'statistics', 'cleanup'],
        },
        {
          locale: 'es-ES',
          name: 'Contenedores',
          publisher_name: 'Redeven oficial',
          summary: 'Gestiona contenedores, imágenes, volúmenes, registros y estadísticas de Docker y Podman en un espacio de trabajo enfocado.',
          keywords: ['contenedores', 'Docker', 'Podman', 'imágenes', 'volúmenes', 'registros', 'estadísticas', 'limpieza'],
        },
        {
          locale: 'fr-FR',
          name: 'Conteneurs',
          publisher_name: 'Redeven officiel',
          summary: 'Gérez les conteneurs, images, volumes, journaux et statistiques Docker et Podman dans un espace de travail dédié.',
          keywords: ['conteneurs', 'Docker', 'Podman', 'images', 'volumes', 'journaux', 'statistiques', 'nettoyage'],
        },
        {
          locale: 'ja-JP',
          name: 'コンテナ',
          publisher_name: 'Redeven 公式',
          summary: 'Docker と Podman のコンテナ、イメージ、ボリューム、ログ、統計を一つのワークスペースで管理します。',
          keywords: ['コンテナ', 'Docker', 'Podman', 'イメージ', 'ボリューム', 'ログ', '統計', 'クリーンアップ'],
        },
        {
          locale: 'ko-KR',
          name: '컨테이너',
          publisher_name: 'Redeven 공식',
          summary: '하나의 집중 작업 공간에서 Docker와 Podman 컨테이너, 이미지, 볼륨, 로그와 통계를 관리합니다.',
          keywords: ['컨테이너', 'Docker', 'Podman', '이미지', '볼륨', '로그', '통계', '정리'],
        },
        {
          locale: 'pt-BR',
          name: 'Contêineres',
          publisher_name: 'Redeven oficial',
          summary: 'Gerencie contêineres, imagens, volumes, logs e estatísticas do Docker e Podman em um espaço de trabalho focado.',
          keywords: ['contêineres', 'Docker', 'Podman', 'imagens', 'volumes', 'logs', 'estatísticas', 'limpeza'],
        },
        {
          locale: 'ru-RU',
          name: 'Контейнеры',
          publisher_name: 'Redeven официально',
          summary: 'Управляйте контейнерами, образами, томами, журналами и статистикой Docker и Podman в едином рабочем пространстве.',
          keywords: ['контейнеры', 'Docker', 'Podman', 'образы', 'тома', 'журналы', 'статистика', 'очистка'],
        },
        {
          locale: 'zh-CN',
          name: '容器',
          publisher_name: 'Redeven 官方',
          summary: '在一个专注的工作区中管理 Docker 和 Podman 容器、镜像、卷、日志与统计信息。',
          keywords: ['容器', 'Docker', 'Podman', '镜像', '卷', '日志', '统计', '清理'],
        },
        {
          locale: 'zh-TW',
          name: '容器',
          publisher_name: 'Redeven 官方',
          summary: '在單一專注工作區中管理 Docker 與 Podman 容器、映像、磁碟區、日誌及統計資料。',
          keywords: ['容器', 'Docker', 'Podman', '映像', '磁碟區', '日誌', '統計', '清理'],
        },
      ],
    },
    categories: ['containers', 'development'],
    channels: ['stable'],
    latest: { channel: 'stable', version: '4.4.1', availability_status: 'visible' },
    release: {
      plugin_id: 'com.redeven.official.containers',
      channel: 'stable',
      version: '4.4.1',
      asset: {
        url: 'https://github.com/floegence/redeven-official-plugins/releases/download/v4.4.1/containers-4.4.1.redevplugin',
      },
      publisher_release_ref: { release_ref: OFFICIAL_CONTAINERS_RELEASE_REF },
      signer_key_id: 'redeven_official_signing_2026',
      compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '0.7.16' },
    },
  }],
};

const containersMarketPlugin = OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins[0]!;

export const OFFICIAL_PLUGIN_MARKET_DETAIL: PluginMarketDetail = {
  generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation,
  plugin_id: containersMarketPlugin.plugin_id,
  publisher_id: containersMarketPlugin.publisher_id,
  presentation: {
    default_locale: containersMarketPlugin.presentation.default_locale,
    locales: containersMarketPlugin.presentation.locales.map((locale) => ({
      ...locale,
      description: [locale.summary],
      highlights: [locale.keywords.join(', ')],
      surfaces: [{ surface_id: 'containers.dashboard', label: locale.name }],
      settings: [],
    })),
  },
  categories: containersMarketPlugin.categories,
  channels: containersMarketPlugin.channels,
  repository: {
    provider: 'github',
    repository_id: 1289352675,
    owner: 'floegence',
    name: 'redeven-official-plugins',
    url: 'https://github.com/floegence/redeven-official-plugins',
  },
  compatibility: containersMarketPlugin.release!.compatibility,
  status: 'active',
  latest: [containersMarketPlugin.latest],
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
