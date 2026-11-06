import { describe, expect, it } from 'vitest';

import { officialPluginCatalog, resolvePluginPresentation } from './officialPluginCatalog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';

describe('official plugin catalog contracts', () => {
  it('uses verified market icon metadata and cached declaration permissions', () => {
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]).toMatchObject({ iconFallback: 'generic' });
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/github.repo.1289352675.metrics/icon');
    expect(officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT)[0]?.permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ permissionID: 'metrics.read', requiredToOpen: true }),
    ]));
  });

  it('projects the latest version from the current frozen market snapshot', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.generation = 3;
    next.plugins[0]!.latest.version = '4.2.0';
    next.plugins[0]!.release!.version = '4.2.0';
    next.plugins[0]!.latest.install_preview!.release.version = '4.2.0';

    expect(officialPluginCatalog(next)[0]).toMatchObject({
      latestVersion: '4.2.0',
      stableVersion: '4.2.0',
      distribution: {
        installSource: { expected: { release: { version: '4.2.0' } } },
      },
    });
  });

  it('preserves the community source classification', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.plugins[0]!.source_kind = 'community';
    expect(officialPluginCatalog(next)[0]?.sourceKind).toBe('community');
  });

  it('projects utility plugins and network access without mislabeling method effects', () => {
    const weather = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    weather.plugins[0]!.categories = ['utilities', 'weather'];
    const preview = weather.plugins[0]!.latest.install_preview!;
    weather.plugins[0]!.latest.install_preview = {
      ...preview,
      security_summary: {
        ...preview.security_summary,
        permissions: [{
          permission_id: 'network.client',
          methods: ['weather.forecast', 'weather.locations.remove'],
          required: true,
          effects: ['delete', 'read', 'write'],
        }],
      },
    };

    expect(officialPluginCatalog(weather)[0]).toMatchObject({
      category: 'utilities',
      permissions: [expect.objectContaining({
        permissionID: 'network.client',
        group: 'network',
      })],
    });
  });

  it('accepts only bounded, digest-bound market icon metadata', () => {
    const sha256 = 'a'.repeat(64);
    const icon = {
      url: `/v1/plugins/github.repo.1289352675.metrics/icon?sha256=${sha256}`,
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
    expect(officialPluginCatalog(next)[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/github.repo.1289352675.metrics/icon');

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

it('does not offer an install preview claiming another repository namespace', () => {
  const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
  next.plugins[0]!.latest.install_preview!.release.source.repository_id = 42;
  expect(officialPluginCatalog(next)).toEqual([]);
});
