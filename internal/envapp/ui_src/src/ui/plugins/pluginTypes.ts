export type PluginLifecycleState =
  | 'not_installed'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'update_available'
  | 'needs_attention';

export type PluginTrustBadge =
  | 'official'
  | 'revoked'
  | 'unavailable'
  | 'blocked';

export type PluginAttentionReason =
  | 'permission_required'
  | 'runtime_missing'
  | 'update_required'
  | 'disabled'
  | 'diagnostic_error'
  | 'catalog_revoked'
  | 'catalog_disabled'
  | 'install_unavailable'
  | 'trust_unavailable';

export type OfficialPluginDistribution = {
  releaseRef: PluginReleaseRef;
};

export type OfficialPluginCatalogItem = {
  pluginID: string;
  publisherID: string;
  pluginInstanceID: string;
  displayName: string;
  description: string;
  publisher: 'Redeven';
  latestVersion: string;
  stableVersion: string;
  minRedevenVersion: string;
  minReDevPluginVersion: string;
  rolloutState: 'stable' | 'staged' | 'disabled' | 'revoked';
  defaultSurfaceID: string;
  iconFallback: 'containers' | 'database' | 'github' | 'generic';
  distribution: OfficialPluginDistribution;
};

export type PluginSurfaceLaunchTarget = {
  pluginID: string;
  pluginInstanceID: string;
  surfaceID: string;
  expectedManagementRevision: number;
  preferredPlacement: 'activity' | 'workbench';
};

export type PluginInventoryItem = {
  pluginID: string;
  pluginInstanceID?: string;
  displayName: string;
  description: string;
  iconURL?: string;
  iconFallback: 'containers' | 'database' | 'github' | 'generic';
  publisher: string;
  version?: string;
  managementRevision?: number;
  lifecycleState: PluginLifecycleState;
  trustBadge: PluginTrustBadge;
  pinned: boolean;
  lastOpenedAt?: string;
  defaultLaunchTarget?: PluginSurfaceLaunchTarget;
  attentionReason?: PluginAttentionReason;
  officialCatalog?: OfficialPluginCatalogItem;
};

export type PluginInventoryProjection = {
  items: PluginInventoryItem[];
};

export type PluginPanelTile =
  | {
      kind: 'open_center';
      id: 'plugin-center';
      label: 'Plugin Center';
    }
  | {
      kind: 'plugin';
      item: PluginInventoryItem;
      action: 'open_surface' | 'open_details';
    };

export type PluginPanelModel = {
  loading: boolean;
  errorMessage?: string;
  tiles: PluginPanelTile[];
};

export type PluginCenterTab = 'installed' | 'discover' | 'updates';

export type PluginCenterModel = {
  activeTab: PluginCenterTab;
  installed: PluginInventoryItem[];
  discover: PluginInventoryItem[];
  updates: PluginInventoryItem[];
  selectedPluginID?: string;
};

export type PluginManagementCommand =
  | { type: 'install'; pluginID: string; source: 'official_catalog' }
  | { type: 'enable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'disable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'uninstall'; pluginInstanceID: string; expectedManagementRevision: number; dataRetention: 'keep_data' | 'delete_data' }
  | { type: 'update'; pluginID: string; pluginInstanceID: string; expectedManagementRevision: number; targetVersion: string };

export type PluginOpenSurfaceCommand = {
  type: 'open_surface';
  pluginID: string;
  pluginInstanceID: string;
  surfaceID: string;
  expectedManagementRevision: number;
  placement: 'activity' | 'workbench';
};

export type PluginLifecycleCommand = PluginManagementCommand | PluginOpenSurfaceCommand;

export type ReDevPluginRecord = PluginRecord;

export type ReDevPluginCatalogResult = PluginCatalogResult;
import type {
  PluginCatalogResult,
  PluginRecord,
  PluginReleaseRef,
} from '@floegence/redevplugin-ui';
