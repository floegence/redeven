import { describe, expect, it } from 'vitest';

import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import { officialPluginCatalog, resolvePluginPresentation } from './officialPluginCatalog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';

describe('official plugin catalog contracts', () => {
  it('pins the published Containers 4.4.7 release identity', () => {
    expect(OFFICIAL_CONTAINERS_RELEASE_REF).toEqual({
      source_id: 'redeven_official',
      channel: 'stable',
      release_metadata_ref: 'plugins/com.redeven.official/com.redeven.official.containers/4.4.7/release.json',
      release_metadata_sha256: '5128bda8747edf7936a16c643beb55fc84f8627f5bb1bcb185a0fc1d68dd0011',
      publisher_id: 'com.redeven.official',
      plugin_id: 'com.redeven.official.containers',
      version: '4.4.7',
      expected_hashes: {
        package_sha256: 'sha256:5d7295d070cc4eff4054ec5f241d7977f0a0a7841b2f984d5d0fff8192eba86d',
        manifest_sha256: 'sha256:20b785d6455a7d16d35304ad6026259a39f5f0fa75890bcd0e1db470c8b3fdb4',
        entries_sha256: 'sha256:79d852072629b98eafbfc6787ab97535fbd6b9f3fe7c32db06893e3fd40e463c',
      },
    });
  });

  it('uses verified market icon metadata without embedding plugin-specific permissions', () => {
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]).toMatchObject({ iconFallback: 'generic' });
    expect(OFFICIAL_PLUGIN_CATALOG_SEED[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/com.redeven.official.containers/icon');
    expect(officialPluginCatalog(OFFICIAL_PLUGIN_MARKET_SNAPSHOT)[0]?.permissions).toBeUndefined();
  });

  it('projects the latest version from the current frozen market snapshot', () => {
    const next = structuredClone(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    next.generation = 3;
    next.plugins[0]!.latest.version = '4.2.0';
    next.plugins[0]!.release!.version = '4.2.0';
    next.plugins[0]!.release!.publisher_release_ref.release_ref.version = '4.2.0';

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
      url: `/v1/plugins/com.redeven.official.containers/icon?sha256=${sha256}`,
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
    expect(officialPluginCatalog(next)[0]?.iconURL).toContain('/_redeven_proxy/api/plugins/market/plugins/com.redeven.official.containers/icon');

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
