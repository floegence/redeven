import compareSemVer from 'semver/functions/compare.js';
import validSemVer from 'semver/functions/valid.js';

import { officialPluginCatalog } from './officialPluginCatalog';
import type {
  OfficialPluginCatalogItem,
  OfficialPluginPermission,
  PluginAuthorizationInventory,
  PluginCenterModel,
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginPanelModel,
  PluginPanelTile,
  ReDevPluginRecord,
} from './pluginTypes';
import type {
  PluginPermissionGrant,
  PluginPermissionRequirements,
  PluginSecurityPolicy,
} from '@floegence/redevplugin-ui';

export function projectPluginInventory(input: {
  officialCatalog?: readonly OfficialPluginCatalogItem[];
  installedPlugins: readonly ReDevPluginRecord[];
  permissionGrants?: readonly PluginPermissionGrant[];
  permissionRequirements?: readonly PluginPermissionRequirements[];
  securityPolicies?: readonly PluginSecurityPolicy[];
}): PluginInventoryProjection {
  const catalog = [...(input.officialCatalog ?? officialPluginCatalog())];
  const installedByIdentity = new Map(input.installedPlugins.map((record) => [pluginIdentityKey(
    record.publisher_id,
    record.plugin_id,
    record.plugin_instance_id,
  ), record]));
  const items: PluginInventoryItem[] = [];
  const grantsByPlugin = groupByPluginInstance(input.permissionGrants ?? []);
  const requirementsByPlugin = new Map((input.permissionRequirements ?? []).map((requirements) => (
    [requirements.plugin_instance_id, requirements]
  )));
  const policyByPlugin = new Map((input.securityPolicies ?? []).map((policy) => [policy.plugin_instance_id, policy]));
  const projectedInstances = new Set<string>();

  for (const catalogItem of catalog) {
    const identityMatch = installedByIdentity.get(pluginIdentityKey(
      catalogItem.publisherID,
      catalogItem.pluginID,
      catalogItem.pluginInstanceID,
    ));
    const installed = identityMatch && isOfficialCatalogRecord(identityMatch, catalogItem)
      ? identityMatch
      : undefined;
    items.push(projectCatalogItem(
      catalogItem,
      installed,
      installed ? grantsByPlugin.get(installed.plugin_instance_id) ?? [] : [],
      installed ? policyByPlugin.get(installed.plugin_instance_id) : undefined,
    ));
    if (installed) projectedInstances.add(installed.plugin_instance_id);
  }

  for (const installed of input.installedPlugins) {
    if (projectedInstances.has(installed.plugin_instance_id)) continue;
    items.push(projectInstalledItem(
      installed,
      grantsByPlugin.get(installed.plugin_instance_id) ?? [],
      requirementsByPlugin.get(installed.plugin_instance_id),
      policyByPlugin.get(installed.plugin_instance_id),
    ));
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

function projectCatalogItem(
  catalogItem: OfficialPluginCatalogItem,
  installed?: ReDevPluginRecord,
  grants: readonly PluginPermissionGrant[] = [],
  policy?: PluginSecurityPolicy,
): PluginInventoryItem {
  if (!installed) {
    return {
      inventoryKey: catalogInventoryKey(catalogItem),
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

  const authorization = projectAuthorization(catalogItem, installed, grants, policy);
  const lifecycleState = installedLifecycleState(installed, catalogItem, authorization);
  const attentionReason = installedAttentionReason(installed, catalogItem, lifecycleState, authorization);
  const externalPackage = externalPackageProjection(installed);
  return {
    inventoryKey: installedInventoryKey(installed.plugin_instance_id),
    pluginID: catalogItem.pluginID,
    pluginInstanceID: installed.plugin_instance_id,
    displayName: manifestDisplayName(installed) || catalogItem.displayName,
    description: catalogItem.description,
    iconFallback: catalogItem.iconFallback,
    publisher: catalogItem.publisher,
    version: installed.version,
    managementRevision: installed.management_revision,
    canDisable: installed.enable_state === 'enabled',
    lifecycleState,
    trustBadge: installedTrustBadge(installed, catalogItem),
    pinned: installed.metadata?.pinned === 'true',
    lastOpenedAt: installed.metadata?.last_opened_at,
    defaultLaunchTarget: lifecycleState === 'enabled'
      ? {
          pluginID: installed.plugin_id,
          pluginInstanceID: installed.plugin_instance_id,
          surfaceID: catalogItem.defaultSurfaceID,
          displayName: manifestDisplayName(installed) || catalogItem.displayName,
          surfaceDisplayNameKey: catalogItem.defaultSurfaceDisplayNameKey,
          expectedManagementRevision: installed.management_revision,
          preferredPlacement: 'activity',
        }
      : undefined,
    attentionReason,
    authorization,
    officialCatalog: catalogItem,
    externalPackage,
  };
}

function projectInstalledItem(
  installed: ReDevPluginRecord,
  grants: readonly PluginPermissionGrant[],
  requirements?: PluginPermissionRequirements,
  policy?: PluginSecurityPolicy,
): PluginInventoryItem {
  const authorization = projectGenericAuthorization(installed, grants, requirements, policy);
  const runnable = isRunnableInstalledTrust(installed);
  const lifecycleState: PluginInventoryItem['lifecycleState'] = !runnable
    ? 'needs_attention'
    : installed.enable_state === 'enabled'
      ? 'enabled'
      : 'disabled';
  const launchSurface = installed.manifest.surfaces.find((surface) => (
    surface.kind === 'view' && (surface.intent ?? 'primary') === 'primary'
  ));
  const externalPackage = externalPackageProjection(installed);
  const publisher = String(installed.manifest.publisher.display_name ?? installed.publisher_id).trim();
  const displayName = manifestDisplayName(installed) || installed.plugin_id;
  return {
    inventoryKey: installedInventoryKey(installed.plugin_instance_id),
    pluginID: installed.plugin_id,
    pluginInstanceID: installed.plugin_instance_id,
    displayName,
    description: installed.plugin_id,
    iconFallback: 'generic',
    publisher,
    version: installed.version,
    managementRevision: installed.management_revision,
    canDisable: installed.enable_state === 'enabled',
    lifecycleState,
    trustBadge: installedTrustBadgeForRecord(installed),
    pinned: installed.metadata?.pinned === 'true',
    lastOpenedAt: installed.metadata?.last_opened_at,
    defaultLaunchTarget: lifecycleState === 'enabled' && launchSurface
      ? {
          pluginID: installed.plugin_id,
          pluginInstanceID: installed.plugin_instance_id,
          surfaceID: launchSurface.surface_id,
          displayName,
          expectedManagementRevision: installed.management_revision,
          preferredPlacement: 'activity',
        }
      : undefined,
    attentionReason: !runnable ? 'trust_unavailable' : lifecycleState === 'disabled' ? 'disabled' : undefined,
    authorization,
    externalPackage,
  };
}

function externalPackageProjection(installed: ReDevPluginRecord): PluginInventoryItem['externalPackage'] {
  return installed.signature_assessment
    && installed.source_provenance
    && installed.execution_approval
    && installed.update_eligibility
    && installed.security_summary
    ? {
        signatureAssessment: installed.signature_assessment,
        sourceProvenance: installed.source_provenance,
        executionApproval: installed.execution_approval,
        updateEligibility: installed.update_eligibility,
        securitySummary: installed.security_summary,
      }
    : undefined;
}

function projectGenericAuthorization(
  installed: ReDevPluginRecord,
  grants: readonly PluginPermissionGrant[],
  requirements?: PluginPermissionRequirements,
  policy?: PluginSecurityPolicy,
): PluginAuthorizationInventory | undefined {
  if (!requirements || requirements.required_permissions.length === 0) return undefined;
  const methodsByPermission = new Map<string, string[]>();
  for (const contract of requirements.contracts) {
    for (const method of contract.methods) {
      for (const permissionID of method.required_permissions) {
        const methods = methodsByPermission.get(permissionID) ?? [];
        if (!methods.includes(method.method)) methods.push(method.method);
        methodsByPermission.set(permissionID, methods);
      }
    }
  }
  return projectAuthorizationFromPermissions(
    requirements.required_permissions.map((permissionID) => ({
      permissionID,
      group: 'other',
      requiredToOpen: false,
      methods: methodsByPermission.get(permissionID) ?? [],
    })),
    installed,
    grants,
    policy,
  );
}

function pluginIdentityKey(publisherID: string, pluginID: string, pluginInstanceID: string): string {
  return `${publisherID}\u0000${pluginID}\u0000${pluginInstanceID}`;
}

function isOfficialCatalogRecord(record: ReDevPluginRecord, item: OfficialPluginCatalogItem): boolean {
  const release = item.distribution.releaseRef;
  if (record.trust_state !== 'verified') return false;
  const currentReleaseMatches = record.version === release.version
    && record.package_hash === release.expected_hashes.package_sha256
    && record.manifest_hash === release.expected_hashes.manifest_sha256
    && record.entries_hash === release.expected_hashes.entries_sha256;
  if (record.version === release.version || record.source_provenance) return currentReleaseMatches;
  const verifiedHashes = record.trust_assessment?.verified_hashes;
  const verifiedSignature = record.trust_assessment?.verified_signature;
  return verifiedSignature?.algorithm === 'ed25519'
    && item.trustedSigningKeyIDs.includes(verifiedSignature.key_id)
    && record.package_hash === verifiedHashes?.package_sha256
    && record.manifest_hash === verifiedHashes?.manifest_sha256
    && record.entries_hash === verifiedHashes?.entries_sha256;
}

function catalogInventoryKey(item: OfficialPluginCatalogItem): string {
  return `catalog:${pluginIdentityKey(item.publisherID, item.pluginID, item.pluginInstanceID)}`;
}

function installedInventoryKey(pluginInstanceID: string): string {
  return `instance:${pluginInstanceID}`;
}

function installedLifecycleState(
  installed: ReDevPluginRecord,
  catalogItem: OfficialPluginCatalogItem,
  authorization?: PluginAuthorizationInventory,
): PluginInventoryItem['lifecycleState'] {
  if (catalogItem.rolloutState === 'revoked' || catalogItem.rolloutState === 'disabled') return 'needs_attention';
  if (!isRunnableInstalledTrust(installed)) return 'needs_attention';
  if (installed.enable_state !== 'enabled') return 'disabled';
  if (compareVersion(installed.version, catalogItem.stableVersion) < 0) return 'update_available';
  if (authorization?.permissions.some((permission) => (
    permission.requiredToOpen && (!permission.granted || permission.deniedByGrant || permission.blockedToOpen)
  ))) return 'needs_attention';
  return 'enabled';
}

function installedTrustBadge(installed: ReDevPluginRecord, catalogItem: OfficialPluginCatalogItem): PluginInventoryItem['trustBadge'] {
  const catalogBadge = catalogTrustBadge(catalogItem);
  if (catalogBadge !== 'official') return catalogBadge;
  if (isRunnableInstalledTrust(installed)) {
    return installed.signature_assessment && installed.signature_assessment.state !== 'verified'
      ? installedTrustBadgeForRecord(installed)
      : 'official';
  }
  const trustState = normalizeTrustState(installed.trust_state);
  return trustState === 'blocked_security' || trustState === 'blocked' ? 'blocked' : 'unavailable';
}

function installedTrustBadgeForRecord(installed: ReDevPluginRecord): PluginInventoryItem['trustBadge'] {
  switch (installed.signature_assessment?.state) {
    case 'verified': return 'verified';
    case 'absent': return 'unsigned';
    case 'unknown_signer': return 'community';
    case 'invalid': return 'blocked';
    case 'revoked': return 'revoked';
    case 'unavailable': return 'unavailable';
    default:
      return normalizeTrustState(installed.trust_state) === 'verified' ? 'verified' : 'unavailable';
  }
}

function installedAttentionReason(
  installed: ReDevPluginRecord,
  catalogItem: OfficialPluginCatalogItem,
  lifecycleState: PluginInventoryItem['lifecycleState'],
  authorization?: PluginAuthorizationInventory,
): PluginInventoryItem['attentionReason'] | undefined {
  const catalogReason = catalogAttentionReason(catalogItem);
  if (catalogReason) return catalogReason;
  if (!isRunnableInstalledTrust(installed)) return 'trust_unavailable';
  if (authorization?.permissions.some((permission) => permission.requiredToOpen && permission.blockedToOpen)) {
    return 'policy_restricted';
  }
  if (authorization?.permissions.some((permission) => (
    permission.requiredToOpen && (!permission.granted || permission.deniedByGrant)
  ))) return 'permission_required';
  if (lifecycleState === 'disabled') return 'disabled';
  if (lifecycleState === 'update_available') return 'update_required';
  return undefined;
}

function projectAuthorization(
  catalogItem: OfficialPluginCatalogItem,
  installed: ReDevPluginRecord,
  grants: readonly PluginPermissionGrant[],
  policy?: PluginSecurityPolicy,
): PluginAuthorizationInventory | undefined {
  return projectAuthorizationFromPermissions(catalogItem.permissions ?? [], installed, grants, policy);
}

function projectAuthorizationFromPermissions(
  metadata: readonly OfficialPluginPermission[],
  installed: ReDevPluginRecord,
  grants: readonly PluginPermissionGrant[],
  policy?: PluginSecurityPolicy,
): PluginAuthorizationInventory | undefined {
  if (metadata.length === 0) return undefined;
  const activeByPermission = new Map(grants.map((grant) => [grant.permission_id, grant]));
  const policyCapsPermissions = Boolean(policy && policy.allowed_permissions.length > 0);
  const deniedMethods = new Set(policy?.denied_methods ?? []);
  return {
    grants,
    policy,
    permissions: metadata.map((permission) => {
      const grant = activeByPermission.get(permission.permissionID);
      const blockedByPermissionAllowlist = Boolean(
        policy && policyCapsPermissions && !policy.allowed_permissions.includes(permission.permissionID),
      );
      const blockedMethods = permission.methods.filter((method) => deniedMethods.has(method));
      const blockedOpeningMethods = (permission.requiredToOpenMethods ?? [])
        .filter((method) => deniedMethods.has(method));
      return {
        ...permission,
        granted: grant?.effect === 'grant',
        deniedByGrant: grant?.effect === 'deny',
        blockedByPolicy: blockedByPermissionAllowlist || blockedMethods.length > 0,
        grantBlockedByPolicy: blockedByPermissionAllowlist,
        blockedToOpen: blockedByPermissionAllowlist || blockedOpeningMethods.length > 0,
      };
    }),
    revisions: {
      policyRevision: policy?.policy_revision ?? installed.policy_revision,
      managementRevision: policy?.management_revision ?? installed.management_revision,
      revokeEpoch: policy?.revoke_epoch ?? installed.revoke_epoch,
    },
  };
}

function groupByPluginInstance(
  grants: readonly PluginPermissionGrant[],
): Map<string, PluginPermissionGrant[]> {
  const grouped = new Map<string, PluginPermissionGrant[]>();
  for (const grant of grants) {
    const current = grouped.get(grant.plugin_instance_id);
    if (current) current.push(grant);
    else grouped.set(grant.plugin_instance_id, [grant]);
  }
  return grouped;
}

function isRunnableInstalledTrust(installed: ReDevPluginRecord | string): boolean {
  if (typeof installed === 'string') return normalizeTrustState(installed) === 'verified';
  const signatureState = installed.signature_assessment?.state;
  if (signatureState === 'invalid' || signatureState === 'revoked') return false;
  const approval = installed.execution_approval?.state;
  if (approval === 'policy_blocked' || approval === 'pending') return false;
  if (approval === 'user_approved' || approval === 'policy_approved') return true;
  const trustState = normalizeTrustState(installed.trust_state);
  return trustState === 'verified' || trustState === 'unsigned_local';
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
  return a.displayName.localeCompare(b.displayName)
    || a.pluginID.localeCompare(b.pluginID)
    || a.inventoryKey.localeCompare(b.inventoryKey);
}

function compareVersion(a: string, b: string): number {
  if (validSemVer(a) !== a || validSemVer(b) !== b) {
    throw new TypeError('Plugin version is not canonical strict SemVer');
  }
  return compareSemVer(a, b);
}
