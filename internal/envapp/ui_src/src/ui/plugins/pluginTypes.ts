export type PluginLifecycleState =
  | 'not_installed'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'update_available'
  | 'needs_attention';

export type PluginSourceBadge = 'official' | 'community';

export type PluginAttentionReason =
  | 'permission_required'
  | 'policy_restricted'
  | 'runtime_missing'
  | 'update_required'
  | 'disabled'
  | 'diagnostic_error'
  | 'catalog_revoked'
  | 'catalog_disabled'
  | 'install_unavailable';

export type PluginProcessStatusState =
  | 'starting'
  | 'running'
  | 'exited'
  | 'blocked'
  | 'crashed'
  | 'stream_gap';

export type PluginProcessStatus = Readonly<{
  state: PluginProcessStatusState;
  eventType: string;
  occurredAt?: string;
  operation?: string;
  stream?: string;
  code?: string;
}>;

export type PluginPresentationCategory =
  | 'development'
  | 'infrastructure'
  | 'utilities'
  | 'data'
  | 'collaboration'
  | 'productivity'
  | 'other';

export type PluginPermissionGroup =
  | 'read'
  | 'execute'
  | 'delete'
  | 'write'
  | 'network'
  | 'other';

export type OfficialPluginDistribution = {
  installSource: ExternalPluginSourcePreset;
};

export type PluginMarketLatestRelease = {
  plugin_id: string;
  publisher_id: string;
  channel: string;
  version: string;
  source: { provider: 'github'; repository_id: number; repository_owner: string; repository_name: string; release_id: number; tag: string; target_commit: string };
  asset: { asset_id: number; name: string; url: string; size: number; sha256: string };
  package_sha256: string;
  manifest_sha256: string;
  entries_sha256: string;
  release_identity_digest: string;
  install_preview?: PluginMarketInstallPreview;
};

export type PluginMarketInstallPreview = Readonly<{
  release: PluginMarketLatestRelease;
  security_summary: PluginExternalPackageSecuritySummary;
  release_identity_digest: string;
  manifest_sha256: string;
  contract_set_sha256: string;
  summary_sha256: string;
}>;

export type PluginMarketSnapshot = {
  schema_version: 'redeven.plugin_market_snapshot.v2';
  generation: number;
  etag?: string;
  cached_at: string;
  stale: boolean;
  source: 'remote' | 'cache';
  plugins: Array<{
    plugin_id: string;
    publisher_id: string;
    source_kind: 'official' | 'community';
    presentation: PluginMarketPresentation;
    categories: string[];
    channels: string[];
    latest: {
      channel: string;
      version: string;
      availability_status: 'visible' | 'disabled' | 'revoked';
      install_preview?: PluginMarketInstallPreview;
    };
    release?: PluginMarketLatestRelease;
  }>;
};

export type PluginMarketRefreshEvent = Readonly<{
  seq: number;
  state: 'refreshing' | 'ready' | 'refresh_failed';
  generation: number;
  stale: boolean;
  checked_at?: string;
  next_refresh_at?: string;
}>;

export type PluginMarketPresentationLocale = Readonly<{
  locale: string;
  name: string;
  publisher_name?: string;
  summary: string;
  keywords: readonly string[];
}>;

export type PluginMarketPresentation = Readonly<{
  default_locale: string;
  locales: readonly PluginMarketPresentationLocale[];
  icon?: PluginMarketIcon;
}>;

export type PluginMarketIcon = Readonly<{
  url: string;
  media_type: 'image/png' | 'image/webp';
  width: number;
  height: number;
  sha256: string;
}>;

export type PluginMarketPresentationFullLocale = PluginMarketPresentationLocale & Readonly<{
  description: readonly string[];
  highlights: readonly string[];
  surfaces: readonly { surface_id: string; label: string }[];
  settings: readonly { key: string; label: string; options: readonly { value: string; label: string }[] }[];
}>;

export type PluginMarketDetail = Readonly<{
  generation?: number;
  plugin_id: string;
  publisher_id: string;
  presentation: Readonly<{ default_locale: string; locales: readonly PluginMarketPresentationFullLocale[]; icon?: PluginMarketIcon }>;
  categories: readonly string[];
  channels: readonly string[];
  repository: Readonly<{ provider: string; repository_id: number; owner: string; name: string; url: string }>;
  status: string;
  latest: readonly {
    channel: string;
    version: string;
    availability_status: 'visible' | 'disabled' | 'revoked';
    install_preview?: PluginMarketInstallPreview;
  }[];
}>;

export type PluginAuthorPresentation = PluginRecord['presentation'];

export type OfficialPluginPermission = {
  permissionID: string;
  group: PluginPermissionGroup;
  requiredToOpen: boolean;
  methods: readonly string[];
  requiredToOpenMethods?: readonly string[];
};

export type OfficialPluginCatalogItem = {
  pluginID: string;
  publisherID: string;
  sourceKind: 'official' | 'community';
  pluginInstanceID: string;
  displayName: string;
  description: string;
  presentation?: PluginMarketPresentation;
  publisher: string;
  marketGeneration?: number;
  latestVersion: string;
  stableVersion: string;
  rolloutState: 'stable' | 'staged' | 'disabled' | 'revoked';
  iconURL?: string;
  iconFallback: 'database' | 'github' | 'generic';
  category: PluginPresentationCategory;
  searchKeywords: readonly string[];
  permissions?: readonly OfficialPluginPermission[];
  installPreview?: PluginMarketInstallPreview;
  distribution: OfficialPluginDistribution;
};

export type PluginPackageIdentity = Readonly<{
  packageHash: string;
  manifestHash: string;
  entriesHash: string;
}>;

export type PluginPermissionState = OfficialPluginPermission & {
  granted: boolean;
  deniedByGrant: boolean;
  blockedByPolicy: boolean;
  grantBlockedByPolicy: boolean;
  blockedToOpen: boolean;
};

export type PluginAuthorizationInventory = {
  grants: readonly PluginPermissionGrant[];
  policy?: PluginSecurityPolicy;
  permissions: readonly PluginPermissionState[];
  revisions: {
    policyRevision: number;
    managementRevision: number;
    revokeEpoch: number;
  };
};

export type PluginSurfaceLaunchTarget = {
  pluginID: string;
  pluginInstanceID: string;
  surfaceID: string;
  displayName?: string;
  expectedManagementRevision: number;
};

export type PluginInventoryItem = {
  inventoryKey: string;
  pluginID: string;
  pluginInstanceID?: string;
  displayName: string;
  description: string;
  iconURL?: string;
  iconFallback: 'database' | 'github' | 'generic';
  category: PluginPresentationCategory;
  searchKeywords: readonly string[];
  publisher: string;
  version?: string;
  managementRevision?: number;
  installedPackage?: PluginPackageIdentity;
  networkConnectors?: readonly { connectorID: string; transport: string; configurable: boolean; httpMethods: string[] }[];
  recoveryIdentity?: Pick<ReDevPluginRecord,
    'plugin_instance_id' | 'active_fingerprint' | 'installed_at' |
    'management_revision' | 'enable_state' | 'deleted_at'>;
  canDisable?: boolean;
  lifecycleState: PluginLifecycleState;
  sourceKind: PluginSourceBadge;
  pinned: boolean;
  lastOpenedAt?: string;
  defaultLaunchTarget?: PluginSurfaceLaunchTarget;
  launchTargets?: readonly PluginSurfaceLaunchTarget[];
  declaredSurfaceIDs?: readonly string[];
  attentionReason?: PluginAttentionReason;
  authorization?: PluginAuthorizationInventory;
  officialCatalog?: OfficialPluginCatalogItem;
  presentation?: PluginAuthorPresentation;
  externalPackage?: {
    sourceProvenance: PluginExternalPackageSourceProvenance;
    executionApproval: PluginExternalPackageExecutionApproval;
    updateEligibility: PluginExternalPackageUpdateEligibility;
    securitySummary: PluginExternalPackageSecuritySummary;
  };
  processStatus?: PluginProcessStatus;
  automaticUpdates?: boolean;
  backgroundInterval?: ReDevPluginRecord['background_interval'];
};

export type PluginUpdateIntent = Readonly<{
  inventoryKey: string;
  pluginID: string;
  pluginInstanceID: string;
  expectedManagementRevision: number;
}>;

export type PluginUpdateCandidate = Readonly<{
  intent: PluginUpdateIntent;
  displayName: string;
  publisher: string;
  installedVersion: string;
  targetVersion: string;
  kind: 'version_update' | 'noop' | 'blocked';
  target: PluginPackageIdentity;
  reviewEvidence: Readonly<{ kind: 'external_inspection'; inspection: ExternalPluginInspection }>;
}>;

export type PluginInventoryProjection = {
  items: PluginInventoryItem[];
  marketUnavailable?: boolean;
};

export type PluginInstallObservation =
  | 'starting'
  | 'watching'
  | 'reconnecting'
  | 'failed'
  | 'finalizing'
  | 'refresh_failed';

export type PluginInstallFailureSource = 'execution' | 'inventory';

export type PluginInstallFailureRecovery =
  | 'review_again'
  | 'refresh_inventory'
  | 'none';

export type PluginInstallFailure = Readonly<{
  source: PluginInstallFailureSource;
  code: string;
  stage?: PluginInstallProgressEvent['stage'];
  retryable: boolean;
  recovery: PluginInstallFailureRecovery;
}>;

export type PluginInstallExecutionProjection = Readonly<{
  pluginID: string;
  pluginInstanceID: string;
  observation: PluginInstallObservation;
  execution?: PluginExecution;
  receipt?: PluginInspectedInstallOperation;
  progress: readonly PluginInstallProgressEvent[];
  failure?: PluginInstallFailure;
}>;

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
  selectedInventoryKey?: string;
};

export type ExternalPluginSourceKind = 'package_url' | 'github_repository' | 'package_upload';

export type ExternalPluginSourcePreset =
  | { sourceKind: 'package_url'; url: string }
  | { sourceKind: 'github_repository'; url: string; tag?: string; pluginID?: string; repositoryID?: string; releaseID?: string; assetID?: string; expected?: PluginMarketInstallPreview };

export type ExternalPluginInspectionRequest =
  | { sourceKind: 'installed_source'; pluginInstanceID: string; expectedManagementRevision: number }
  | {
      sourceKind: 'package_url';
      url: string;
      intent: PluginUploadedExternalPackageIntent;
    }
  | {
      sourceKind: 'github_repository';
      url: string;
      tag?: string;
      pluginID?: string;
      repositoryID?: string;
      releaseID?: string;
      assetID?: string;
      expected?: PluginMarketInstallPreview;
      intent: PluginUploadedExternalPackageIntent;
    }
  | {
      sourceKind: 'package_upload';
      file: File;
      intent: PluginUploadedExternalPackageIntent;
    };

export type PluginManagementCommand =
  | { type: 'enable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'disable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'uninstall'; pluginInstanceID: string; expectedManagementRevision: number; dataRetention: 'keep_data' | 'delete_data' }
  | {
      type: 'grant_permission';
      pluginInstanceID: string;
      permissionID: string;
      expectedPolicyRevision: number;
      expectedManagementRevision: number;
      expectedRevokeEpoch: number;
    }
  | {
      type: 'revoke_permission';
      pluginInstanceID: string;
      permissionID: string;
      expectedPolicyRevision: number;
      expectedManagementRevision: number;
      expectedRevokeEpoch: number;
    };


export type PluginOpenSurfaceCommand = {
  type: 'open_surface';
  pluginID: string;
  pluginInstanceID: string;
  surfaceID: string;
  expectedManagementRevision: number;
};

export type PluginLifecycleCommand = PluginManagementCommand | PluginOpenSurfaceCommand;
export type PluginPendingCommandType = PluginLifecycleCommand['type'] | 'install' | 'update';

export type ReDevPluginRecord = Omit<PluginRecord, 'presentation' | 'presentation_sha256'> & {
  presentation?: PluginRecord['presentation'];
  presentation_sha256?: string;
  action_state?: PluginCatalogRecord['action_state'];
  background_interval?: PluginCatalogRecord['background_interval'];
};

export type ReDevPluginCatalogResult = PluginCatalogResult;

export type ExternalPluginInspection = Omit<PluginExternalPackageInspection, 'presentation' | 'presentation_sha256' | 'security_summary'> & {
  presentation?: PluginExternalPackageInspection['presentation'];
  presentation_sha256?: string;
  security_summary: PluginExternalPackageSecuritySummary;
};
export type ExternalPluginCommitResult = { plugin?: ReDevPluginRecord; operation: PluginInspectedInstallOperation };
export type PluginExternalPackageSourceProvenance = ExternalPluginInspection['source_provenance'];
export type PluginExternalPackageExecutionApproval = ExternalPluginInspection['execution_approval'];
export type PluginExternalPackageUpdateEligibility = ExternalPluginInspection['update_eligibility'];

export type PluginExternalPackageProcessMethodAccessSummary = Readonly<{
  method: string;
  operations: readonly string[];
}>;

export type PluginExternalPackageProcessSummary = Readonly<{
  resource_limits: Readonly<{
    output_buffer_bytes: number;
    max_runtime_ms: number;
  }>;
  method_access: readonly PluginExternalPackageProcessMethodAccessSummary[];
}>;

export type PluginExternalPackageBackgroundSummary = NonNullable<PluginExternalPackageInspection['security_summary']['background']>;

export type PluginExternalPackageSecuritySummary = PluginExternalPackageInspection['security_summary'] & Readonly<{
  process?: PluginExternalPackageProcessSummary;
  background?: PluginExternalPackageBackgroundSummary;
}>;
import type {
  PluginCatalogResult,
  PluginCatalogRecord,
  PluginExternalPackageInspection,
  PluginInspectedInstallOperation,
  PluginExecution,
  PluginPermissionGrant,
  PluginRecord,
  PluginInstallProgressEvent,
  PluginRecoveryResult,
  PluginSecurityPolicy,
  PluginUploadedExternalPackageIntent,
} from '@floegence/redevplugin-ui';

export type PluginRuntimeRecoveryReason = NonNullable<PluginRecoveryResult['reason']>;
export type PluginRuntimeRecoveryAction = NonNullable<PluginRecoveryResult['action']>;
export type PluginRuntimeRecoveryPresentation = Readonly<
  | { state: 'recovering'; error?: undefined; reason?: undefined; action?: undefined }
  | { state: 'ready'; error?: undefined; reason?: undefined; action?: undefined }
  | {
    state: 'failed';
    error?: string;
    reason?: PluginRuntimeRecoveryReason;
    action?: PluginRuntimeRecoveryAction;
  }
>;
