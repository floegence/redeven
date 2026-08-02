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
      summary: '在 Redeven 中管理 Docker 和 Podman 资源。',
    });
    expect(resolvePluginPresentation(item, 'zh-TW-Hant')).toMatchObject({ resolved_locale: 'en-US' });
  });

});
