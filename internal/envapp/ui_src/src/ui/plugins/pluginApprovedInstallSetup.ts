import type { PluginLifecycleAPI } from './pluginApi';
import type { PluginInventoryItem, PluginInventoryProjection } from './pluginTypes';

type ApprovedInstallLifecycle = Pick<PluginLifecycleAPI, 'execute'>;

export type ApprovedOfficialInstallSetupResult = 'ready' | 'superseded';

export async function completeApprovedOfficialInstall(options: Readonly<{
  pluginInstanceID: string;
  lifecycle: ApprovedInstallLifecycle;
  refreshInventory: () => Promise<PluginInventoryProjection | undefined>;
  signal?: AbortSignal;
}>): Promise<ApprovedOfficialInstallSetupResult> {
  const attemptedPermissions = new Set<string>();
  let item = await requireInstalledItem(options);

  while (true) {
    const permission = item.authorization?.permissions.find((candidate) => (
      candidate.requiredToOpen
      && !candidate.granted
      && !attemptedPermissions.has(candidate.permissionID)
    ));
    if (!permission) break;
    const previousDecision = item.authorization?.grants.find((grant) => (
      grant.permission_id === permission.permissionID
    ));
    // A denied, revoked, or expired decision is newer user/security intent.
    // Installation recovery may complete untouched reviewed grants, but it
    // must never overwrite a decision that already has durable history.
    if (previousDecision) return 'superseded';
    if (permission.grantBlockedByPolicy) {
      throw new Error(`Required plugin permission is blocked by policy: ${permission.permissionID}`);
    }
    const revisions = item.authorization?.revisions;
    if (!revisions) throw new Error('Installed plugin permission revisions are unavailable');
    attemptedPermissions.add(permission.permissionID);
    await options.lifecycle.execute({
      type: 'grant_permission',
      pluginInstanceID: options.pluginInstanceID,
      permissionID: permission.permissionID,
      expectedPolicyRevision: revisions.policyRevision,
      expectedManagementRevision: revisions.managementRevision,
      expectedRevokeEpoch: revisions.revokeEpoch,
    }, { signal: options.signal });
    item = await requireInstalledItem(options);
  }

  const unresolved = item.authorization?.permissions.find((permission) => (
    permission.requiredToOpen && !permission.granted
  ));
  if (unresolved) {
    throw new Error(`Required plugin permission was not granted: ${unresolved.permissionID}`);
  }

  // Fresh official installs commit enabled. A disabled record therefore
  // represents newer user intent and is not installation recovery work.
  if (item.lifecycleState === 'disabled') return 'superseded';

  if (item.lifecycleState !== 'enabled' && item.lifecycleState !== 'update_available') {
    throw new Error(`Installed plugin is not ready to open: ${item.lifecycleState}`);
  }
  return 'ready';
}

async function requireInstalledItem(options: Readonly<{
  pluginInstanceID: string;
  refreshInventory: () => Promise<PluginInventoryProjection | undefined>;
}>): Promise<PluginInventoryItem> {
  const projection = await options.refreshInventory();
  const item = projection?.items.find((candidate) => candidate.pluginInstanceID === options.pluginInstanceID);
  if (!item) throw new Error('Installed plugin is missing from the refreshed inventory');
  return item;
}
