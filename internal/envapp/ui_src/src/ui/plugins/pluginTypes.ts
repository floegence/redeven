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

export type OfficialPluginDistribution = {
  releaseRef: PluginReleaseRef;
};

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
  publisher: 'Redeven';
  latestVersion: string;
  stableVersion: string;
  minRedevenVersion: string;
  minReDevPluginVersion: string;
  rolloutState: 'stable' | 'staged' | 'disabled' | 'revoked';
  defaultSurfaceID: string;
  defaultSurfaceDisplayNameKey?: 'uiCopy.plugin.containersDashboardSurface';
  iconFallback: 'containers' | 'database' | 'github' | 'generic';
  trustedSigningKeyIDs: readonly string[];
  permissions?: readonly OfficialPluginPermission[];
  distribution: OfficialPluginDistribution;
};

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
  surfaceDisplayNameKey?: 'uiCopy.plugin.containersDashboardSurface';
  expectedManagementRevision: number;
  preferredPlacement: 'activity' | 'workbench';
};

export type PluginInventoryItem = {
  inventoryKey: string;
  pluginID: string;
  pluginInstanceID?: string;
  displayName: string;
  description: string;
  iconURL?: string;
  iconFallback: 'containers' | 'database' | 'github' | 'generic';
  publisher: string;
  version?: string;
  managementRevision?: number;
  canDisable?: boolean;
  lifecycleState: PluginLifecycleState;
  trustBadge: PluginTrustBadge;
  pinned: boolean;
  lastOpenedAt?: string;
  defaultLaunchTarget?: PluginSurfaceLaunchTarget;
  attentionReason?: PluginAttentionReason;
  authorization?: PluginAuthorizationInventory;
  officialCatalog?: OfficialPluginCatalogItem;
  externalPackage?: {
    signatureAssessment: PluginExternalPackageSignatureAssessment;
    sourceProvenance: PluginExternalPackageSourceProvenance;
    executionApproval: PluginExternalPackageExecutionApproval;
    updateEligibility: PluginExternalPackageUpdateEligibility;
    securitySummary: PluginExternalPackageSecuritySummary;
  };
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
  selectedInventoryKey?: string;
};

export type ExternalPluginSourceKind = 'package_url' | 'github_repository' | 'package_upload';

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
  | { type: 'install'; pluginID: string; source: 'official_catalog' }
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
};

export type PluginLifecycleCommand = PluginManagementCommand | PluginOpenSurfaceCommand;

export type ReDevPluginRecord = PluginRecord;

export type ReDevPluginCatalogResult = PluginCatalogResult;

export type ExternalPluginInspection = PluginExternalPackageInspection;
export type ExternalPluginCommitResult = Extract<PluginExternalPackageCommitResult, { status: 'committed' }>;
export type PluginExternalPackageSignatureAssessment = ExternalPluginInspection['signature_assessment'];
export type PluginExternalPackageSourceProvenance = ExternalPluginInspection['source_provenance'];
export type PluginExternalPackageExecutionApproval = ExternalPluginInspection['execution_approval'];
export type PluginExternalPackageUpdateEligibility = ExternalPluginInspection['update_eligibility'];
export type PluginExternalPackageSecuritySummary = ExternalPluginInspection['security_summary'];
import type {
  PluginCatalogResult,
  PluginExternalPackageCommitResult,
  PluginExternalPackageInspection,
  PluginPermissionGrant,
  PluginRecord,
  PluginReleaseRef,
  PluginSecurityPolicy,
  PluginUploadedExternalPackageIntent,
} from '@floegence/redevplugin-ui';
