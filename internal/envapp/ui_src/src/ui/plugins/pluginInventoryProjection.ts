import compareSemVer from 'semver/functions/compare.js';
import validSemVer from 'semver/functions/valid.js';

import { officialPluginCatalog } from './officialPluginCatalog';
import type {
  OfficialPluginCatalogItem,
  PluginCenterModel,
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginPanelModel,
  PluginPanelTile,
  ReDevPluginRecord,
} from './pluginTypes';

export function projectPluginInventory(input: {
  officialCatalog?: readonly OfficialPluginCatalogItem[];
  installedPlugins: readonly ReDevPluginRecord[];
}): PluginInventoryProjection {
  const catalog = [...(input.officialCatalog ?? officialPluginCatalog())];
  const installedByIdentity = new Map(input.installedPlugins.map((record) => [pluginIdentityKey(
    record.publisher_id,
    record.plugin_id,
    record.plugin_instance_id,
  ), record]));
  const items: PluginInventoryItem[] = [];

  for (const catalogItem of catalog) {
    const installed = installedByIdentity.get(pluginIdentityKey(
      catalogItem.publisherID,
      catalogItem.pluginID,
      catalogItem.pluginInstanceID,
    ));
    items.push(projectCatalogItem(catalogItem, installed));
  }

  return { items: items.sort(compareInventoryItems) };
}

export function buildPluginPanelModel(
  projection: PluginInventoryProjection,
  errorMessage?: string,
  options: { canOpenSurfaces?: boolean; loading?: boolean } = {},
): PluginPanelModel {
  const tiles: PluginPanelTile[] = [
    { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
    ...projection.items.map((item): PluginPanelTile => ({
      kind: 'plugin',
      item,
      action: options.canOpenSurfaces && item.lifecycleState === 'enabled' && item.defaultLaunchTarget ? 'open_surface' : 'open_details',
    })),
  ];
  return { loading: Boolean(options.loading), errorMessage, tiles };
}

export function buildPluginCenterModel(projection: PluginInventoryProjection, activeTab: PluginCenterTab = 'installed'): PluginCenterModel {
  const installed = projection.items.filter((item) => Boolean(item.pluginInstanceID));
  const discover = projection.items.filter((item) => !item.pluginInstanceID && item.trustBadge === 'official' && item.lifecycleState === 'not_installed');
  const updates = projection.items.filter((item) => item.lifecycleState === 'update_available');
  return { activeTab, installed, discover, updates };
}

function projectCatalogItem(catalogItem: OfficialPluginCatalogItem, installed?: ReDevPluginRecord): PluginInventoryItem {
  if (!installed) {
    return {
      pluginID: catalogItem.pluginID,
      displayName: catalogItem.displayName,
      description: catalogItem.description,
      iconFallback: catalogItem.iconFallback,
      publisher: catalogItem.publisher,
      lifecycleState: catalogState(catalogItem),
      trustBadge: catalogTrustBadge(catalogItem),
      pinned: false,
      attentionReason: catalogAttentionReason(catalogItem),
      officialCatalog: catalogItem,
    };
  }

  const lifecycleState = installedLifecycleState(installed, catalogItem);
  const attentionReason = installedAttentionReason(installed, catalogItem, lifecycleState);
  return {
    pluginID: catalogItem.pluginID,
    pluginInstanceID: installed.plugin_instance_id,
    displayName: manifestDisplayName(installed) || catalogItem.displayName,
    description: catalogItem.description,
    iconFallback: catalogItem.iconFallback,
    publisher: catalogItem.publisher,
    version: installed.version,
    managementRevision: installed.management_revision,
    lifecycleState,
    trustBadge: installedTrustBadge(installed, catalogItem),
    pinned: installed.metadata?.pinned === 'true',
    lastOpenedAt: installed.metadata?.last_opened_at,
    defaultLaunchTarget: lifecycleState === 'enabled'
      ? {
          pluginID: installed.plugin_id,
          pluginInstanceID: installed.plugin_instance_id,
          surfaceID: catalogItem.defaultSurfaceID,
          expectedManagementRevision: installed.management_revision,
          preferredPlacement: 'activity',
        }
      : undefined,
    attentionReason,
    officialCatalog: catalogItem,
  };
}

function pluginIdentityKey(publisherID: string, pluginID: string, pluginInstanceID: string): string {
  return `${publisherID}\u0000${pluginID}\u0000${pluginInstanceID}`;
}

function installedLifecycleState(installed: ReDevPluginRecord, catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['lifecycleState'] {
  if (catalogItem.rolloutState === 'revoked' || catalogItem.rolloutState === 'disabled') return 'needs_attention';
  if (!isRunnableInstalledTrust(installed.trust_state)) return 'needs_attention';
  if (installed.enable_state !== 'enabled') return 'disabled';
  if (compareVersion(installed.version, catalogItem.stableVersion) < 0) return 'update_available';
  return 'enabled';
}

function installedTrustBadge(installed: ReDevPluginRecord, catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['trustBadge'] {
  const catalogBadge = catalogTrustBadge(catalogItem);
  if (catalogBadge !== 'official') return catalogBadge;
  if (isRunnableInstalledTrust(installed.trust_state)) return 'official';
  const trustState = normalizeTrustState(installed.trust_state);
  return trustState === 'blocked_security' || trustState === 'blocked' ? 'blocked' : 'unavailable';
}

function installedAttentionReason(
  installed: ReDevPluginRecord,
  catalogItem: OfficialPluginCatalogItem,
  lifecycleState: PluginInventoryItem['lifecycleState'],
): PluginInventoryItem['attentionReason'] | undefined {
  const catalogReason = catalogAttentionReason(catalogItem);
  if (catalogReason) return catalogReason;
  if (!isRunnableInstalledTrust(installed.trust_state)) return 'trust_unavailable';
  if (lifecycleState === 'disabled') return 'disabled';
  if (lifecycleState === 'update_available') return 'update_required';
  return undefined;
}

function isRunnableInstalledTrust(trustState: string): boolean {
  switch (normalizeTrustState(trustState)) {
    case 'verified':
      return true;
    default:
      return false;
  }
}

function normalizeTrustState(trustState: string): string {
  return String(trustState ?? '').trim().toLowerCase();
}

function catalogState(catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['lifecycleState'] {
  if (catalogItem.rolloutState === 'revoked' || catalogItem.rolloutState === 'disabled') return 'needs_attention';
  return 'not_installed';
}

function catalogTrustBadge(catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['trustBadge'] {
  if (catalogItem.rolloutState === 'revoked') return 'revoked';
  if (catalogItem.rolloutState === 'disabled') return 'blocked';
  return 'official';
}

function catalogAttentionReason(catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['attentionReason'] | undefined {
  if (catalogItem.rolloutState === 'revoked') return 'catalog_revoked';
  if (catalogItem.rolloutState === 'disabled') return 'catalog_disabled';
  return undefined;
}

function manifestDisplayName(installed: ReDevPluginRecord): string {
  return String(installed.manifest?.plugin?.display_name ?? '').trim();
}

function compareInventoryItems(a: PluginInventoryItem, b: PluginInventoryItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const aOpened = Date.parse(a.lastOpenedAt ?? '');
  const bOpened = Date.parse(b.lastOpenedAt ?? '');
  if (Number.isFinite(aOpened) && Number.isFinite(bOpened) && aOpened !== bOpened) return bOpened - aOpened;
  if (Number.isFinite(aOpened) !== Number.isFinite(bOpened)) return Number.isFinite(aOpened) ? -1 : 1;
  return a.displayName.localeCompare(b.displayName) || a.pluginID.localeCompare(b.pluginID);
}

function compareVersion(a: string, b: string): number {
  if (validSemVer(a) !== a || validSemVer(b) !== b) {
    throw new TypeError('Plugin version is not canonical strict SemVer');
  }
  return compareSemVer(a, b);
}
