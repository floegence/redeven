import { EXAMPLE_PLUGIN_RELEASE_REF } from './examplePluginRelease.test-fixture';
import { officialPluginCatalog } from './officialPluginCatalog';
import type { OfficialPluginPermission, PluginMarketDetail, PluginMarketSnapshot } from './pluginTypes';

export const OFFICIAL_PLUGIN_MARKET_SNAPSHOT: PluginMarketSnapshot = {
  schema_version: 'redeven.plugin_market_snapshot.v2',
  generation: 13,
  etag: '"catalog-g13"',
  cached_at: '2026-08-23T00:00:00Z',
  stale: false,
  source: 'remote',
  plugins: [{
    plugin_id: 'com.example.metrics',
    publisher_id: 'com.example',
    presentation: {
      default_locale: 'en-US',
      icon: {
        url: '/v1/plugins/com.example.metrics/icon?sha256=949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1',
        media_type: 'image/png',
        width: 512,
        height: 512,
        sha256: '949adb221cd3e990ebe350947cc17d1b415d6175f99df98aeb5c47d70fb3cce1',
      },
      locales: [
        {
          locale: 'de-DE',
          name: 'Metriken',
          publisher_name: 'Example Herausgeber',
          summary: 'Zeigt neutrale Laufzeitmetriken für Tests der allgemeinen Plugin-Plattform an.',
          keywords: ['Metriken', 'CPU', 'Speicher', 'Beispiel'],
        },
        {
          locale: 'en-US',
          name: 'Metrics',
          publisher_name: 'Example Publisher',
          summary: 'Shows neutral runtime metrics for general plugin platform tests.',
          keywords: ['metrics', 'CPU', 'memory', 'example'],
        },
        {
          locale: 'es-ES',
          name: 'Métricas',
          publisher_name: 'Example Publisher',
          summary: 'Muestra métricas de ejecución neutrales para las pruebas generales de la plataforma de plugins.',
          keywords: ['métricas', 'CPU', 'memoria', 'ejemplo'],
        },
        {
          locale: 'fr-FR',
          name: 'Métriques',
          publisher_name: 'Example Publisher',
          summary: 'Affiche des métriques d’exécution neutres pour les tests généraux de la plateforme de plugins.',
          keywords: ['métriques', 'CPU', 'mémoire', 'exemple'],
        },
        {
          locale: 'ja-JP',
          name: 'メトリクス',
          publisher_name: 'Example Publisher',
          summary: '一般的なプラグインプラットフォームのテスト用に中立的な実行メトリクスを表示します。',
          keywords: ['メトリクス', 'CPU', 'メモリ', 'サンプル'],
        },
        {
          locale: 'ko-KR',
          name: '메트릭',
          publisher_name: 'Example Publisher',
          summary: '일반 플러그인 플랫폼 테스트를 위한 중립적인 런타임 메트릭을 표시합니다.',
          keywords: ['메트릭', 'CPU', '메모리', '예시'],
        },
        {
          locale: 'pt-BR',
          name: 'Métricas',
          publisher_name: 'Example Publisher',
          summary: 'Mostra métricas de execução neutras para testes gerais da plataforma de plugins.',
          keywords: ['métricas', 'CPU', 'memória', 'exemplo'],
        },
        {
          locale: 'ru-RU',
          name: 'Метрики',
          publisher_name: 'Example Publisher',
          summary: 'Показывает нейтральные метрики среды выполнения для общих тестов платформы плагинов.',
          keywords: ['метрики', 'ЦП', 'память', 'пример'],
        },
        {
          locale: 'zh-CN',
          name: '指标',
          publisher_name: 'Example Publisher',
          summary: '显示用于通用插件平台测试的中性运行时指标。',
          keywords: ['指标', 'CPU', '内存', '示例'],
        },
        {
          locale: 'zh-TW',
          name: '指標',
          publisher_name: 'Example Publisher',
          summary: '顯示用於通用外掛程式平台測試的中性執行階段指標。',
          keywords: ['指標', 'CPU', '記憶體', '範例'],
        },
      ],
    },
    categories: ['observability', 'development'],
    channels: ['stable'],
    latest: {
      channel: 'stable',
      version: '4.4.9',
      availability_status: 'visible',
      install_preview: {
        release_ref: EXAMPLE_PLUGIN_RELEASE_REF,
        compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '3.0.5' },
        security_summary: {
          permissions: [
            { permission_id: 'metrics.read', methods: ['metrics.status', 'metrics.list'], required: true, effects: ['read'] },
            { permission_id: 'metrics.execute', methods: ['metrics.start'], required: false, effects: ['execute'] },
          ],
        },
        release_identity_digest: 'sha256:824e51f410a597845d546835e61271b8a530044c51e2d14a098eb847adf1e181',
        manifest_sha256: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.manifest_sha256,
        contract_set_sha256: 'sha256:9229d7b5a76273a40818deb9fedb64ee83146cf11ec66edda20743c38eebd9ab',
        summary_sha256: 'sha256:ef067082e92647c5e5ab73787bc2f5e6d83ce9a60be56daf738293103e9d9673',
        release: {
          plugin_id: 'com.example.metrics',
          channel: 'stable',
          version: '4.4.9',
          asset: { url: 'https://github.com/example/example-plugins/releases/download/v4.4.9/metrics-4.4.9.redevplugin' },
          publisher_release_ref: { release_ref: EXAMPLE_PLUGIN_RELEASE_REF },
          signer_key_id: 'example_signing_key_2026',
          compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '3.0.5' },
        },
      },
    },
    release: {
      plugin_id: 'com.example.metrics',
      channel: 'stable',
      version: '4.4.9',
      asset: {
        url: 'https://github.com/example/example-plugins/releases/download/v4.4.9/metrics-4.4.9.redevplugin',
      },
      publisher_release_ref: { release_ref: EXAMPLE_PLUGIN_RELEASE_REF },
      signer_key_id: 'example_signing_key_2026',
      compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '3.0.5' },
    },
  }],
};

const exampleMarketPlugin = OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins[0]!;

export const OFFICIAL_PLUGIN_MARKET_DETAIL: PluginMarketDetail = {
  generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation,
  plugin_id: exampleMarketPlugin.plugin_id,
  publisher_id: exampleMarketPlugin.publisher_id,
  presentation: {
    default_locale: exampleMarketPlugin.presentation.default_locale,
    locales: exampleMarketPlugin.presentation.locales.map((locale) => ({
      ...locale,
      description: [locale.summary],
      highlights: [locale.keywords.join(', ')],
      surfaces: [{ surface_id: 'metrics.dashboard', label: locale.name }],
      settings: [],
    })),
  },
  categories: exampleMarketPlugin.categories,
  channels: exampleMarketPlugin.channels,
  repository: {
    provider: 'github',
    repository_id: 1289352675,
    owner: 'floegence',
    name: 'example-plugins',
    url: 'https://github.com/example/example-plugins',
  },
  compatibility: exampleMarketPlugin.release!.compatibility,
  status: 'active',
  latest: [exampleMarketPlugin.latest],
};

const examplePermissionFixture: readonly OfficialPluginPermission[] = [
  {
    permissionID: 'metrics.read',
    group: 'read',
    requiredToOpen: true,
    requiredToOpenMethods: ['metrics.status', 'metrics.list'],
    methods: ['metrics.status', 'metrics.list', 'metrics.inspect'],
  },
  {
    permissionID: 'metrics.execute',
    group: 'execute',
    requiredToOpen: false,
    methods: ['metrics.start'],
  },
];

// Permission declarations are supplied by Host inventory in production. This
// fixture keeps projection tests focused on authorization state without making
// the catalog adapter own a plugin-specific permission table.
export const OFFICIAL_PLUGIN_CATALOG_SEED = officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT).map((item) => ({
  ...item,
  permissions: examplePermissionFixture,
}));
