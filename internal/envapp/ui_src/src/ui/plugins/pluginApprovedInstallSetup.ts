import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';

import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInventoryItem, PluginInventoryProjection } from './pluginTypes';

type ApprovedInstallLifecycle = Pick<PluginLifecycleAPI, 'grantPermission'>;

export type ApprovedOfficialInstallSetupResult = 'ready' | 'superseded';

export class ApprovedInstallInventoryRefreshError extends Error {
  constructor(cause?: unknown) {
    super('Plugin inventory refresh failed while finalizing installation', { cause });
    this.name = 'ApprovedInstallInventoryRefreshError';
  }
}

export async function completeApprovedOfficialInstall(options: Readonly<{
  pluginInstanceID: string;
  lifecycle: ApprovedInstallLifecycle;
  refreshInventory: () => Promise<PluginInventoryProjection | undefined>;
  inventory: PluginInventoryProjection;
  signal?: AbortSignal;
}>): Promise<ApprovedOfficialInstallSetupResult> {
  const item = requireInstalledItem(options.pluginInstanceID, options.inventory);
  if (item.lifecycleState === 'disabled') return 'superseded';

  const missingPermissions = item.authorization?.permissions.filter((permission) => (
    permission.requiredToOpen && !permission.granted
  )) ?? [];
  for (const permission of missingPermissions) {
    // Any durable decision is newer user or security intent. Inspect every
    // permission before issuing the first mutation so finalization cannot
    // partially restore a set the user already changed.
    const previousDecision = item.authorization?.grants.find((grant) => (
      grant.permission_id === permission.permissionID
    ));
    if (previousDecision) return 'superseded';
    if (permission.grantBlockedByPolicy) {
      throw new Error(`Required plugin permission is blocked by policy: ${permission.permissionID}`);
    }
  }

  let revisions = item.authorization?.revisions;
  if (missingPermissions.length > 0 && !revisions) {
    throw new Error('Installed plugin permission revisions are unavailable');
  }
  for (const permission of missingPermissions) {
    try {
      const mutation = await options.lifecycle.grantPermission({
        type: 'grant_permission',
        pluginInstanceID: options.pluginInstanceID,
        permissionID: permission.permissionID,
        expectedPolicyRevision: revisions!.policyRevision,
        expectedManagementRevision: revisions!.managementRevision,
        expectedRevokeEpoch: revisions!.revokeEpoch,
      }, { signal: options.signal });
      revisions = {
        policyRevision: mutation.revisions.policy_revision,
        managementRevision: mutation.revisions.management_revision,
        revokeEpoch: mutation.revisions.revoke_epoch,
      };
    } catch (error) {
      if (isAuthorizationRevisionConflict(error)) return 'superseded';
      throw error;
    }
  }

  let finalItem = item;
  if (missingPermissions.length > 0) {
    let refreshed: PluginInventoryProjection | undefined;
    try {
      refreshed = await options.refreshInventory();
    } catch (error) {
      throw new ApprovedInstallInventoryRefreshError(error);
    }
    if (!refreshed) throw new ApprovedInstallInventoryRefreshError();
    const refreshedItem = findInstalledItem(options.pluginInstanceID, refreshed);
    if (!refreshedItem) return 'superseded';
    finalItem = refreshedItem;
  }

  if (finalItem.lifecycleState === 'disabled') return 'superseded';
  const unresolved = finalItem.authorization?.permissions.find((permission) => (
    permission.requiredToOpen && !permission.granted
  ));
  if (unresolved) {
    const newerDecision = finalItem.authorization?.grants.find((grant) => (
      grant.permission_id === unresolved.permissionID
    ));
    if (newerDecision) return 'superseded';
    throw new Error(`Required plugin permission was not granted: ${unresolved.permissionID}`);
  }

  if (finalItem.lifecycleState !== 'enabled' && finalItem.lifecycleState !== 'update_available') {
    throw new Error(`Installed plugin is not ready to open: ${finalItem.lifecycleState}`);
  }
  if (!finalItem.defaultLaunchTarget) {
    throw new Error('Installed plugin has no launchable surface');
  }
  return 'ready';
}

function isAuthorizationRevisionConflict(error: unknown): boolean {
  return error instanceof PluginPlatformRequestError
    && (
      error.errorCode === 'PLUGIN_AUTHORIZATION_REVISION_MISMATCH'
      || error.errorCode === 'PLUGIN_MANAGEMENT_REVISION_MISMATCH'
    );
}

function requireInstalledItem(
  pluginInstanceID: string,
  projection: PluginInventoryProjection,
): PluginInventoryItem {
  const item = findInstalledItem(pluginInstanceID, projection);
  if (!item) throw new Error('Installed plugin is missing from the refreshed inventory');
  return item;
}

function findInstalledItem(
  pluginInstanceID: string,
  projection: PluginInventoryProjection,
): PluginInventoryItem | undefined {
  return projection.items.find((candidate) => candidate.pluginInstanceID === pluginInstanceID);
}
