import { describe, expect, it } from 'vitest';

import { EXAMPLE_PLUGIN_RELEASE_REF } from './examplePluginRelease.test-fixture';
import { officialPluginCatalog, resolvePluginPresentation } from './officialPluginCatalog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';

describe('official plugin catalog contracts', () => {
  it('pins a neutral example release identity', () => {
    expect(EXAMPLE_PLUGIN_RELEASE_REF).toEqual({
      source_id: 'example_market',
      channel: 'stable',
      release_metadata_ref: 'plugins/com.example/com.example.metrics/4.4.9/release.json',
      release_metadata_sha256: '7f36244ce5fe5f80751051f1aa2adcb49d049eab2f748d751ae7021cbf074a15',
      publisher_id: 'com.example',
      plugin_id: 'com.example.metrics',
      version: '4.4.9',
      expected_hashes: {
        package_sha256: 'sha256:954894fbc63c3490fe011c9a6baf8985258a3c9c98a16827ed8342aaf438ed32',
        manifest_sha256: 'sha256:ab8c23c53758bba5165fd4d50c7972e94791dd1ccff75de02c51c554767fb12b',
        entries_sha256: 'sha256:8b043db413f20ae08be6252f74bbd82fc17a82592192d40c9947a5fcb9983c0f',
      },
    });
  });

  it('uses verified market icon metadata and cached declaration permissions', () => {
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]).toMatchObject({ iconFallback: 'generic' });
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/com.example.metrics/icon');
    expect(officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT)[0]?.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ permissionID: 'metrics.read', requiredToOpen: true }),
    ]));
  });

  it('projects the latest version from the current frozen market snapshot', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.generation = 3;
    next.plugins[0]!.latest.version = '4.2.0';
    next.plugins[0]!.release!.version = '4.2.0';
    next.plugins[0]!.release!.publisher_release_ref.release_ref.version = '4.2.0';
    next.plugins[0]!.latest.install_preview!.release_ref.version = '4.2.0';

    expect(officialPluginCatalog(next)[0]).toMatchObject({
      latestVersion: '4.2.0',
      stableVersion: '4.2.0',
      distribution: {
        releaseRef: { version: '4.2.0' },
      },
    });
  });

  it('accepts only bounded, digest-bound market icon metadata', () => {
    const sha256 = 'a'.repeat(64);
    const icon = {
      url: `/v1/plugins/com.example.metrics/icon?sha256=${sha256}`,
      media_type: 'image/png' as const,
      width: 128,
      height: 128,
      sha256,
    };
    const next = {
      ...structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT),
      plugins: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins.map((plugin, index) => index === 0
        ? { ...plugin, presentation: { ...plugin.presentation, icon } }
        : plugin),
    };
    expect(officialPluginCatalog(next)[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/com.example.metrics/icon');

    const unsafe = {
      ...next,
      plugins: next.plugins.map((plugin, index) => index === 0
        ? { ...plugin, presentation: { ...plugin.presentation, icon: { ...icon, url: 'javascript:alert(1)' } } }
        : plugin),
    };
    expect(officialPluginCatalog(unsafe)[0]?.iconURL).toBeUndefined();

    const digestMismatch = {
      ...next,
      plugins: next.plugins.map((plugin, index) => index === 0
        ? { ...plugin, presentation: { ...plugin.presentation, icon: { ...icon, sha256: 'b'.repeat(64) } } }
        : plugin),
    };
    expect(officialPluginCatalog(digestMismatch)[0]?.iconURL).toBeUndefined();
  });

  it('resolves the author presentation with RFC 4647 fallback', () => {
    const item = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
    expect(resolvePluginPresentation(item, 'zh-CN')).toMatchObject({
      resolved_locale: 'zh-CN',
      plugin_name: '指标',
      summary: '显示用于通用插件平台测试的中性运行时指标。',
    });
    expect(resolvePluginPresentation(item, 'zh-TW-x-market')).toMatchObject({
      resolved_locale: 'zh-TW',
      summary: '顯示用於通用外掛程式平台測試的中性執行階段指標。',
    });
  });

  it('keeps every Redeven locale in the neutral catalog projection', () => {
    const locales = OFFICIAL_PLUGIN_MARKET_SNAPSHOT.plugins[0]!.presentation.locales.map(({ locale }) => locale);
    expect(locales).toEqual([
      'de-DE', 'en-US', 'es-ES', 'fr-FR', 'ja-JP',
      'ko-KR', 'pt-BR', 'ru-RU', 'zh-CN', 'zh-TW',
    ]);
    for (const locale of locales) {
      expect(resolvePluginPresentation(OFFICIAL_PLUGIN_CATALOG_SEED[0]!, locale)?.resolved_locale).toBe(locale);
    }
  });

});
