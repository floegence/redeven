import type { PluginInventoryItem } from './pluginTypes';

export const PLUGIN_MOBILE_TOUCH_TARGET_CLASS = 'min-h-[46px] min-w-[46px] sm:min-h-0 sm:min-w-0';

export type PluginPrimaryAction =
  | 'install'
  | 'review_permissions'
  | 'enable'
  | 'open_activity'
  | 'review_update'
  | 'view_policy'
  | 'view_runtime'
  | 'view_trust'
  | 'view_diagnostics'
  | 'view_details';

export type PluginPresentation = Readonly<{
  primaryAction: PluginPrimaryAction;
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  canOpenWorkbench: boolean;
  canDisable: boolean;
  canCheckForUpdate: boolean;
  canUninstall: boolean;
}>;

const FAIL_CLOSED_TRUST = new Set<PluginInventoryItem['trustBadge']>([
  'blocked',
  'revoked',
  'unavailable',
]);

export function presentPlugin(item: PluginInventoryItem): PluginPresentation {
  const installed = Boolean(item.pluginInstanceID);
  const trustBlocked = FAIL_CLOSED_TRUST.has(item.trustBadge)
    || item.externalPackage?.executionApproval.state === 'policy_blocked'
    || item.externalPackage?.executionApproval.state === 'pending';
  const requiredPermissions = item.authorization?.permissions.filter((permission) => permission.requiredToOpen) ?? [];
  const policyBlocksOpening = requiredPermissions.some((permission) => permission.blockedToOpen);
  const requiredAccessMissing = requiredPermissions.some((permission) => (
    !permission.granted || permission.deniedByGrant
  ));

  let primaryAction: PluginPrimaryAction;
  let tone: PluginPresentation['tone'];
  if (trustBlocked || item.attentionReason === 'catalog_revoked' || item.attentionReason === 'catalog_disabled') {
    primaryAction = 'view_trust';
    tone = 'error';
  } else if (!installed) {
    primaryAction = item.lifecycleState === 'not_installed' ? 'install' : 'view_details';
    tone = item.lifecycleState === 'not_installed' ? 'neutral' : 'warning';
  } else if (policyBlocksOpening || item.attentionReason === 'policy_restricted') {
    primaryAction = 'view_policy';
    tone = 'warning';
  } else if (item.lifecycleState === 'update_available' || item.attentionReason === 'update_required') {
    primaryAction = 'review_update';
    tone = 'info';
  } else if (requiredAccessMissing || item.attentionReason === 'permission_required') {
    primaryAction = 'review_permissions';
    tone = 'warning';
  } else if (item.attentionReason === 'runtime_missing') {
    primaryAction = 'view_runtime';
    tone = 'warning';
  } else if (item.attentionReason === 'diagnostic_error' || item.attentionReason === 'install_unavailable') {
    primaryAction = 'view_diagnostics';
    tone = 'warning';
  } else if (item.lifecycleState === 'disabled' || item.lifecycleState === 'installed') {
    primaryAction = 'enable';
    tone = 'neutral';
  } else if (item.lifecycleState === 'enabled' && item.defaultLaunchTarget) {
    primaryAction = 'open_activity';
    tone = 'success';
  } else {
    primaryAction = 'view_details';
    tone = item.lifecycleState === 'enabled' ? 'warning' : 'neutral';
  }

  return Object.freeze({
    primaryAction,
    tone,
    canOpenWorkbench: primaryAction === 'open_activity' && Boolean(item.defaultLaunchTarget),
    canDisable: installed && Boolean(item.canDisable),
    canCheckForUpdate: installed && !trustBlocked && Boolean(item.externalPackage || item.officialCatalog),
    canUninstall: installed,
  });
}
