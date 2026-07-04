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
  installedPlugins?: readonly ReDevPluginRecord[];
}): PluginInventoryProjection {
  const catalog = [...(input.officialCatalog ?? officialPluginCatalog())];
  const installedByPluginID = new Map((input.installedPlugins ?? []).map((record) => [record.plugin_id, record]));
  const items: PluginInventoryItem[] = [];

  for (const catalogItem of catalog) {
    const installed = installedByPluginID.get(catalogItem.pluginID);
    items.push(projectCatalogItem(catalogItem, installed));
  }

  return { items: items.sort(compareInventoryItems) };
}

export function buildPluginPanelModel(
  projection: PluginInventoryProjection,
  errorMessage?: string,
  options: { canOpenSurfaces?: boolean } = {},
): PluginPanelModel {
  const tiles: PluginPanelTile[] = [
    { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
    ...projection.items.map((item): PluginPanelTile => ({
      kind: 'plugin',
      item,
      action: options.canOpenSurfaces && item.lifecycleState === 'enabled' && item.defaultLaunchTarget ? 'open_surface' : 'open_details',
    })),
  ];
  return { loading: false, errorMessage, tiles };
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
    description: manifestDescription(installed) || catalogItem.description,
    iconFallback: catalogItem.iconFallback,
    publisher: catalogItem.publisher,
    version: installed.version,
    lifecycleState,
    trustBadge: installedTrustBadge(installed, catalogItem),
    pinned: installed.metadata?.pinned === 'true',
    lastOpenedAt: installed.metadata?.last_opened_at,
    defaultLaunchTarget: lifecycleState === 'enabled'
      ? {
          pluginInstanceID: installed.plugin_instance_id,
          surfaceID: catalogItem.defaultSurfaceID,
          preferredPlacement: 'activity',
        }
      : undefined,
    attentionReason,
    officialCatalog: catalogItem,
  };
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
    case 'bundled':
    case 'verified':
    case 'unsigned_local':
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

function manifestDescription(installed: ReDevPluginRecord): string {
  return String(installed.manifest?.plugin?.description ?? '').trim();
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
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
