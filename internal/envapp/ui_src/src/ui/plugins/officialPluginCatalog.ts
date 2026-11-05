import type {
  OfficialPluginCatalogItem,
  OfficialPluginPermission,
  PluginMarketInstallPreview,
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

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function normalizedInstallPreview(
  plugin: PluginMarketSnapshot['plugins'][number],
): PluginMarketInstallPreview | undefined {
  const preview = plugin.latest.install_preview;
  if (!preview || !preview.security_summary || !Array.isArray(preview.security_summary.permissions)) return undefined;
  if (!SHA256_DIGEST.test(preview.release_identity_digest)
    || !SHA256_DIGEST.test(preview.manifest_sha256)
    || !SHA256_DIGEST.test(preview.contract_set_sha256)
    || !SHA256_DIGEST.test(preview.summary_sha256)) return undefined;
  const release = preview.release;
  if (!release || release.plugin_id !== plugin.plugin_id || release.publisher_id !== plugin.publisher_id
    || release.channel !== plugin.latest.channel || release.version !== plugin.latest.version) return undefined;
  return preview;
}

function normalizedPermissions(
  preview: PluginMarketInstallPreview,
): readonly OfficialPluginPermission[] {
  const byID = new Map<string, OfficialPluginPermission>();
  for (const permission of preview.security_summary.permissions) {
    if (!/^[a-z][a-z0-9._:-]{0,127}$/u.test(permission.permission_id)) continue;
    const group = permissionGroup(permission.permission_id, permission.effects);
    const current = byID.get(permission.permission_id);
    if (!current) {
      byID.set(permission.permission_id, {
        permissionID: permission.permission_id,
        group,
        requiredToOpen: permission.required === true,
        methods: [],
      });
      continue;
    }
    byID.set(permission.permission_id, {
      ...current,
      requiredToOpen: current.requiredToOpen || permission.required === true,
      group: current.group === 'other' ? group : current.group,
    });
  }
  return [...byID.values()];
}

function permissionGroup(
  permissionID: string,
  effects: readonly string[],
): OfficialPluginPermission['group'] {
  if (permissionID === 'network.client' || permissionID.startsWith('network.')) return 'network';
  if (effects.includes('delete')) return 'delete';
  if (effects.includes('execute')) return 'execute';
  if (effects.includes('write')) return 'write';
  if (effects.includes('read')) return 'read';
  return 'other';
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

function validatedMarketIcon(
  icon: PluginMarketSnapshot['plugins'][number]['presentation']['icon'],
  pluginID: string,
): string | undefined {
  if (!icon || !Number.isSafeInteger(icon.width) || !Number.isSafeInteger(icon.height)
    || icon.width < 1 || icon.width > 512 || icon.height < 1 || icon.height > 512
    || (icon.media_type !== 'image/png' && icon.media_type !== 'image/webp')
    || !/^[0-9a-f]{64}$/.test(icon.sha256)
    || !/^[a-z][a-z0-9._-]{0,127}$/.test(pluginID)
    || !icon.url.startsWith('/') || icon.url.startsWith('//')) return undefined;
  try {
    const marketOrigin = 'https://plugin-market.invalid';
    const url = new URL(icon.url, marketOrigin);
    const digests = url.searchParams.getAll('sha256');
    if (url.origin !== marketOrigin || url.pathname !== `/v1/plugins/${pluginID}/icon`
      || url.hash || [...url.searchParams.keys()].length !== 1 || digests.length !== 1
      || digests[0] !== icon.sha256) return undefined;
    return `/_redeven_proxy/api/plugins/market/plugins/${pluginID}/icon?sha256=${icon.sha256}`;
  } catch {
    return undefined;
  }
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
    const installPreview = normalizedInstallPreview(plugin);
    if (plugin.latest.channel !== 'stable' || !installPreview) return [];
    const release = installPreview.release;
    if (release.publisher_id !== plugin.publisher_id
      || release.plugin_id !== plugin.plugin_id
      || release.channel !== plugin.latest.channel
      || release.version !== plugin.latest.version) return [];
    const presentation = plugin.presentation;
    if (!presentation) return [];
    const defaultLocale = presentation.locales.find((locale) => locale.locale === presentation.default_locale);
    if (!defaultLocale) return [];
    return [{
      pluginID: plugin.plugin_id,
      publisherID: plugin.publisher_id,
      sourceKind: plugin.source_kind,
      pluginInstanceID: `catalog_${plugin.publisher_id}_${plugin.plugin_id}`,
      displayName: defaultLocale.name,
      description: defaultLocale.summary,
      presentation,
      publisher: defaultLocale.publisher_name ?? plugin.publisher_id,
      marketGeneration: snapshot.generation,
      latestVersion: plugin.latest.version,
      stableVersion: plugin.latest.version,
      rolloutState: marketRolloutState(plugin.latest.availability_status),
      iconURL: validatedMarketIcon(presentation.icon, plugin.plugin_id),
      iconFallback: 'generic' as const,
      category: marketCategory(plugin.categories),
      searchKeywords: [...new Set(presentation.locales.flatMap((locale) => locale.keywords))],
      permissions: normalizedPermissions(installPreview),
      installPreview,
      distribution: {
        installSource: {
          sourceKind: 'github_repository' as const,
          url: `https://github.com/${release.source.repository_owner}/${release.source.repository_name}`,
          tag: release.source.tag,
          pluginID: release.plugin_id,
          repositoryID: String(release.source.repository_id),
          releaseID: String(release.source.release_id),
          assetID: String(release.asset.asset_id),
          expected: installPreview,
        },
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
  if (categories.includes('utilities') || categories.includes('weather')) return 'utilities';
  return 'other';
}
