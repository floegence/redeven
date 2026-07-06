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
  releaseChannel: 'github_release_and_redeven_cdn';
  artifactName: string;
  officialArtifactPath: string;
};

export type OfficialPluginCatalogItem = {
  pluginID: string;
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
  pluginInstanceID: string;
  surfaceID: string;
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

export type PluginLifecycleCommand =
  | { type: 'install'; pluginID: string; source: 'official_catalog' }
  | { type: 'enable'; pluginInstanceID: string }
  | { type: 'disable'; pluginInstanceID: string }
  | { type: 'uninstall'; pluginInstanceID: string; dataRetention: 'keep_data' | 'delete_data' }
  | { type: 'update'; pluginID: string; pluginInstanceID: string; targetVersion: string }
  | { type: 'open_surface'; pluginInstanceID: string; surfaceID: string; placement: 'activity' | 'workbench' };

export type ReDevPluginRecord = {
  plugin_instance_id: string;
  publisher_id?: string;
  plugin_id: string;
  version: string;
  active_fingerprint?: string;
  package_hash?: string;
  manifest_hash?: string;
  trust_state: string;
  enable_state: string;
  disabled_reason?: string;
  retained_data_state?: string;
  manifest?: {
    plugin?: {
      display_name?: string;
      description?: string;
    };
    surfaces?: Array<{
      surface_id?: string;
      label?: string;
    }>;
  } & Record<string, unknown>;
  installed_at?: string;
  enabled_at?: string;
  updated_at?: string;
  metadata?: Record<string, string>;
};

export type ReDevPluginCatalogResult = {
  plugins?: ReDevPluginRecord[];
};

export type PluginOpenSurfaceResult = {
  plugin_id: string;
  plugin_instance_id: string;
  surface_id: string;
  surface_instance_id: string;
  active_fingerprint: string;
  owner_session_hash?: string;
  owner_user_hash?: string;
  session_channel_id_hash?: string;
  asset_ticket: string;
  asset_ticket_id: string;
  bridge_nonce: string;
  issued_at?: string;
  expires_at?: string;
};
