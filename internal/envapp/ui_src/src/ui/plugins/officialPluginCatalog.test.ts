import { describe, expect, it } from 'vitest';

import { officialPluginCatalog, resolvePluginPresentation } from './officialPluginCatalog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';

describe('official plugin catalog contracts', () => {
  it('does not embed plugin-specific icon or permission metadata in the market adapter', () => {
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]).toMatchObject({ iconFallback: 'generic' });
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]?.iconURL).toBeUndefined();
    expect(officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT)[0]?.permissions).toEqual([]);
  });

  it('projects the latest version from the current frozen market snapshot', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.generation = 2;
    next.plugins[0]!.latest.version = '4.1.0';
    next.plugins[0]!.release!.version = '4.1.0';
    next.plugins[0]!.release!.publisher_release_ref.release_ref.version = '4.1.0';

    expect(officialPluginCatalog(next)[0]).toMatchObject({
      latestVersion: '4.1.0',
      stableVersion: '4.1.0',
      distribution: {
        releaseRef: { version: '4.1.0' },
      },
    });
  });

  it('resolves the author presentation with RFC 4647 fallback', () => {
    const item = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
    expect(resolvePluginPresentation(item, 'zh-CN')).toMatchObject({
      resolved_locale: 'zh-CN',
      plugin_name: '容器',
      summary: '在一个专注的工作区中管理 Docker 和 Podman 容器、镜像、卷、日志与统计信息。',
    });
    expect(resolvePluginPresentation(item, 'zh-TW-x-market')).toMatchObject({
      resolved_locale: 'zh-TW',
      summary: '在單一專注工作區中管理 Docker 與 Podman 容器、映像、磁碟區、日誌及統計資料。',
    });
  });

  it('keeps every Redeven locale in the signed Containers catalog projection', () => {
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
