export type PluginLifecycleState =
  | 'not_installed'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'update_available'
  | 'needs_attention';

export type PluginTrustBadge =
  | 'official'
  | 'verified'
  | 'unsigned'
  | 'community'
  | 'revoked'
  | 'unavailable'
  | 'blocked';

export type PluginAttentionReason =
  | 'permission_required'
  | 'policy_restricted'
  | 'runtime_missing'
  | 'update_required'
  | 'disabled'
  | 'diagnostic_error'
  | 'catalog_revoked'
  | 'catalog_disabled'
  | 'install_unavailable'
  | 'trust_unavailable';

export type PluginPresentationCategory =
  | 'development'
  | 'infrastructure'
  | 'data'
  | 'collaboration'
  | 'productivity'
  | 'other';

export type OfficialPluginDistribution = {
  releaseRef: PluginReleaseRef;
  installSource: ExternalPluginSourcePreset;
};

export type PluginMarketLatestRelease = {
  plugin_id: string;
  channel: string;
  version: string;
  asset: {
    url: string;
  };
  publisher_release_ref: {
    release_ref: PluginReleaseRef;
  };
  signer_key_id: string;
  compatibility: {
    min_redeven_version: string;
    min_redevplugin_version: string;
  };
};

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
    presentation: PluginMarketPresentation;
    categories: string[];
    channels: string[];
    latest: {
      channel: string;
      version: string;
      availability_status: 'visible' | 'disabled' | 'revoked';
    };
    release?: PluginMarketLatestRelease;
  }>;
};

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
  compatibility: Readonly<{ min_redeven_version: string; min_redevplugin_version: string }>;
  status: string;
  latest: readonly { channel: string; version: string; availability_status: 'visible' | 'disabled' | 'revoked' }[];
}>;

export type PluginAuthorPresentation = PluginRecord['presentation'];

export type OfficialPluginPermission = {
  permissionID: string;
  group: 'read' | 'execute' | 'delete' | 'images_write' | 'other';
  requiredToOpen: boolean;
  methods: readonly string[];
  requiredToOpenMethods?: readonly string[];
};

export type OfficialPluginCatalogItem = {
  pluginID: string;
  publisherID: string;
  pluginInstanceID: string;
  displayName: string;
  description: string;
  presentation?: PluginMarketPresentation;
  publisher: string;
  marketGeneration?: number;
  latestVersion: string;
  stableVersion: string;
  minRedevenVersion: string;
  minReDevPluginVersion: string;
  rolloutState: 'stable' | 'staged' | 'disabled' | 'revoked';
  defaultSurfaceID: string;
  iconURL?: string;
  iconFallback: 'database' | 'github' | 'generic';
  category: PluginPresentationCategory;
  searchKeywords: readonly string[];
  trustedSigningKeyIDs: readonly string[];
  permissions?: readonly OfficialPluginPermission[];
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
  preferredPlacement: 'activity' | 'workbench';
  /** Ephemeral client point used when a Workbench launcher tile is dropped. */
  workbenchDropPoint?: Readonly<{ clientX: number; clientY: number }>;
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
  canDisable?: boolean;
  lifecycleState: PluginLifecycleState;
  trustBadge: PluginTrustBadge;
  pinned: boolean;
  lastOpenedAt?: string;
  defaultLaunchTarget?: PluginSurfaceLaunchTarget;
  attentionReason?: PluginAttentionReason;
  authorization?: PluginAuthorizationInventory;
  officialCatalog?: OfficialPluginCatalogItem;
  presentation?: PluginAuthorPresentation;
  externalPackage?: {
    signatureAssessment: PluginExternalPackageSignatureAssessment;
    sourceProvenance: PluginExternalPackageSourceProvenance;
    executionApproval: PluginExternalPackageExecutionApproval;
    updateEligibility: PluginExternalPackageUpdateEligibility;
    securitySummary: PluginExternalPackageSecuritySummary;
  };
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
  kind: 'version_update' | 'replace' | 'noop' | 'blocked';
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
  | 'refreshing'
  | 'refresh_failed';

export type PluginInstallExecutionProjection = Readonly<{
  pluginID: string;
  pluginInstanceID: string;
  observation: PluginInstallObservation;
  execution?: PluginExecution;
  events: readonly PluginEvent[];
  startFailure?: Readonly<{
    code: PluginPlatformErrorCode;
    retryable: boolean;
  }>;
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
  | { sourceKind: 'github_repository'; url: string; tag?: string };

export type ExternalPluginInspectionRequest =
  | {
      sourceKind: 'package_url';
      url: string;
      intent: PluginUploadedExternalPackageIntent;
    }
  | {
      sourceKind: 'github_repository';
      url: string;
      tag?: string;
      intent: PluginUploadedExternalPackageIntent;
    }
  | {
      sourceKind: 'package_upload';
      file: File;
      intent: PluginUploadedExternalPackageIntent;
    };

export type PluginManagementCommand =
  | {
      type: 'install';
      pluginID: string;
      source: 'official_catalog';
      approvedPermissionIDs?: readonly string[];
    }
  | { type: 'enable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'disable'; pluginInstanceID: string; expectedManagementRevision: number }
  | { type: 'uninstall'; pluginInstanceID: string; expectedManagementRevision: number; dataRetention: 'keep_data' | 'delete_data' }
  | { type: 'update'; pluginID: string; pluginInstanceID: string; expectedManagementRevision: number; targetVersion: string }
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
  placement: 'activity' | 'workbench';
  /** Keep the Plugin Center route as the owning surface while Activity opens. */
  keepPluginCenter?: boolean;
};

export type PluginLifecycleCommand = PluginManagementCommand | PluginOpenSurfaceCommand;
export type PluginPendingCommandType = PluginLifecycleCommand['type'];

export type ReDevPluginRecord = Omit<PluginRecord, 'presentation' | 'presentation_sha256'> & {
  presentation?: PluginRecord['presentation'];
  presentation_sha256?: string;
  action_state?: PluginCatalogRecord['action_state'];
};

export type ReDevPluginCatalogResult = PluginCatalogResult;

export type ExternalPluginInspection = Omit<PluginExternalPackageInspection, 'presentation' | 'presentation_sha256'> & {
  presentation?: PluginExternalPackageInspection['presentation'];
  presentation_sha256?: string;
};
export type ExternalPluginCommitResult = Omit<PluginInstalledExternalPackage, 'plugin'> & {
  plugin: ReDevPluginRecord;
};
export type PluginExternalPackageSignatureAssessment = ExternalPluginInspection['signature_assessment'];
export type PluginExternalPackageSourceProvenance = ExternalPluginInspection['source_provenance'];
export type PluginExternalPackageExecutionApproval = ExternalPluginInspection['execution_approval'];
export type PluginExternalPackageUpdateEligibility = ExternalPluginInspection['update_eligibility'];
export type PluginExternalPackageSecuritySummary = ExternalPluginInspection['security_summary'];
import type {
  PluginCatalogResult,
  PluginCatalogRecord,
  PluginExternalPackageInspection,
  PluginInstalledExternalPackage,
  PluginExecution,
  PluginEvent,
  PluginPermissionGrant,
  PluginPlatformErrorCode,
  PluginRecord,
  PluginReleaseRef,
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
