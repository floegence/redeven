import type {
  OfficialPluginCatalogItem,
  PluginMarketSnapshot,
  PluginAuthorPresentation,
  PluginMarketDetail,
  PluginPresentationCategory,
} from './pluginTypes';
import { resolvePresentation } from '@floegence/redevplugin-contracts';

export function officialPluginCatalog(
  snapshot?: PluginMarketSnapshot,
): readonly OfficialPluginCatalogItem[] {
  return Object.freeze(snapshot ? projectMarketSnapshot(snapshot) : []);
}

export function resolvePluginPresentation(
  item: OfficialPluginCatalogItem,
  requestedLocale: string,
): ReturnType<typeof resolvePresentation> | undefined {
  if (!item.presentation) return undefined;
  return resolvePresentation(compactPresentationCatalog(item.presentation), requestedLocale);
}

export function resolveAuthorPresentation(
  presentation: PluginAuthorPresentation | PluginMarketDetail['presentation'],
  requestedLocale: string,
): ReturnType<typeof resolvePresentation> {
  return resolvePresentation(fullPresentationCatalog(presentation), requestedLocale);
}

function compactPresentationCatalog(presentation: OfficialPluginCatalogItem['presentation']) {
  if (!presentation) throw new Error('Official plugin catalog item is missing manifest presentation');
  return {
    default_locale: presentation.default_locale,
    locales: presentation.locales.map((locale) => ({
      locale: locale.locale,
      plugin_name: locale.name,
      ...(locale.publisher_name ? { publisher_name: locale.publisher_name } : {}),
      summary: locale.summary,
      description: [],
      highlights: [],
      keywords: [...locale.keywords],
      surfaces: [],
      settings: [],
    })),
  };
}

function fullPresentationCatalog(presentation: PluginAuthorPresentation | PluginMarketDetail['presentation']) {
  return {
    default_locale: presentation.default_locale,
    locales: presentation.locales.map((locale) => ({
      locale: locale.locale,
      plugin_name: 'plugin_name' in locale ? locale.plugin_name : locale.name,
      ...(locale.publisher_name ? { publisher_name: locale.publisher_name } : {}),
      summary: locale.summary,
      description: [...locale.description],
      highlights: [...locale.highlights],
      keywords: [...locale.keywords],
      surfaces: locale.surfaces.map((surface) => ({ surface_id: surface.surface_id, label: surface.label })),
      settings: locale.settings.map((setting) => ({
        key: setting.key,
        label: setting.label,
        options: setting.options.map((option) => ({ value: option.value, label: option.label })),
      })),
    })),
  };
}

function projectMarketSnapshot(snapshot: PluginMarketSnapshot): OfficialPluginCatalogItem[] {
  if (snapshot.schema_version !== 'redeven.plugin_market_snapshot.v2'
    || !Number.isSafeInteger(snapshot.generation)
    || snapshot.generation < 0
    || !Array.isArray(snapshot.plugins)) {
    throw new Error('Plugin market snapshot metadata is invalid');
  }
  return snapshot.plugins.flatMap((plugin) => {
    if (plugin.latest.channel !== 'stable'
      || plugin.release?.plugin_id !== plugin.plugin_id
      || plugin.release.channel !== plugin.latest.channel
      || plugin.release.version !== plugin.latest.version) return [];
    const releaseRef = plugin.release.publisher_release_ref.release_ref;
    if (releaseRef.publisher_id !== plugin.publisher_id
      || releaseRef.plugin_id !== plugin.plugin_id
      || releaseRef.channel !== plugin.latest.channel
      || releaseRef.version !== plugin.latest.version) return [];
    const presentation = plugin.presentation;
    if (!presentation) return [];
    const defaultLocale = presentation.locales.find((locale) => locale.locale === presentation.default_locale);
    if (!defaultLocale) return [];
    return [{
      pluginID: plugin.plugin_id,
      publisherID: plugin.publisher_id,
      pluginInstanceID: `catalog_${plugin.publisher_id}_${plugin.plugin_id}`,
      displayName: defaultLocale.name,
      description: defaultLocale.summary,
      presentation,
      publisher: defaultLocale.publisher_name ?? plugin.publisher_id,
      marketGeneration: snapshot.generation,
      latestVersion: plugin.latest.version,
      stableVersion: plugin.latest.version,
      minRedevenVersion: plugin.release.compatibility.min_redeven_version,
      minReDevPluginVersion: plugin.release.compatibility.min_redevplugin_version,
      rolloutState: marketRolloutState(plugin.latest.availability_status),
      defaultSurfaceID: 'plugin.primary',
      iconFallback: 'generic' as const,
      category: marketCategory(plugin.categories),
      searchKeywords: [...new Set(presentation.locales.flatMap((locale) => locale.keywords))],
      trustedSigningKeyIDs: [plugin.release.signer_key_id],
      permissions: [],
      distribution: {
        releaseRef,
        installSource: { sourceKind: 'package_url' as const, url: plugin.release.asset.url },
      },
    }];
  });
}

function marketRolloutState(status: 'visible' | 'disabled' | 'revoked'): OfficialPluginCatalogItem['rolloutState'] {
  if (status === 'visible') return 'stable';
  return status;
}

function marketCategory(categories: readonly string[]): PluginPresentationCategory {
  if (categories.includes('development')) return 'development';
  if (categories.includes('containers') || categories.includes('infrastructure')) return 'infrastructure';
  return 'other';
}
