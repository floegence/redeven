import type { PluginInventoryItem, PluginPendingCommandType } from './pluginTypes';
import type { I18nHelpers } from '../i18n';

export const PLUGIN_MOBILE_TOUCH_TARGET_CLASS = 'min-h-[46px] min-w-[46px] sm:min-h-0 sm:min-w-0';
export const PLUGIN_ENTER_MOTION_CLASS = 'redeven-plugin-motion redeven-plugin-enter-up animate-in fade-in duration-200 ease-out motion-reduce:animate-none';
export const PLUGIN_PRESS_MOTION_CLASS = 'redeven-plugin-motion transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none';

export type PluginPrimaryAction =
  | 'install'
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
  canOpenActivity: boolean;
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
  const lifecycleAllowsOpening = item.lifecycleState === 'enabled'
    || item.lifecycleState === 'update_available';
  const attentionBlocksOpening = item.attentionReason === 'catalog_revoked'
    || item.attentionReason === 'catalog_disabled'
    || item.attentionReason === 'policy_restricted'
    || item.attentionReason === 'permission_required'
    || item.attentionReason === 'runtime_missing'
    || item.attentionReason === 'diagnostic_error'
    || item.attentionReason === 'install_unavailable'
    || item.attentionReason === 'trust_unavailable';
  const canOpen = installed
    && lifecycleAllowsOpening
    && Boolean(item.defaultLaunchTarget)
    && !trustBlocked
    && !policyBlocksOpening
    && !requiredAccessMissing
    && !attentionBlocksOpening;

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
    // Permission changes are managed from the details permission controls. The
    // primary card action must remain an executable lifecycle action rather
    // than a misleading link that only scrolls the page.
    primaryAction = 'enable';
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
    canOpenActivity: canOpen,
    canOpenWorkbench: canOpen,
    canDisable: installed && Boolean(item.canDisable),
    canCheckForUpdate: installed && !trustBlocked && Boolean(item.externalPackage || item.officialCatalog),
    canUninstall: installed,
  });
}

export function pluginLifecycleLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.lifecycleState) {
    case 'not_installed': return i18n.t('uiCopy.plugin.available');
    case 'installed': return i18n.t('uiCopy.plugin.installed');
    case 'enabled': return i18n.t('uiCopy.plugin.enabled');
    case 'disabled': return i18n.t('uiCopy.plugin.disabled');
    case 'update_available': return i18n.t('uiCopy.plugin.updateAvailable');
    case 'needs_attention': return i18n.t('uiCopy.plugin.needsAttention');
    default: return i18n.t('uiCopy.plugin.unavailable');
  }
}

export function pluginPendingCommandLabel(command: PluginPendingCommandType, i18n: I18nHelpers): string {
  switch (command) {
    case 'install': return i18n.t('uiCopy.plugin.installOperation.starting');
    case 'enable': return i18n.t('uiCopy.plugin.lifecycleOperation.enabling');
    case 'disable': return i18n.t('uiCopy.plugin.lifecycleOperation.disabling');
    case 'uninstall': return i18n.t('uiCopy.plugin.lifecycleOperation.uninstalling');
    case 'update': return i18n.t('uiCopy.plugin.lifecycleOperation.updating');
    case 'grant_permission': return i18n.t('uiCopy.plugin.lifecycleOperation.grantingPermission');
    case 'revoke_permission': return i18n.t('uiCopy.plugin.lifecycleOperation.revokingPermission');
    case 'open_surface': return i18n.t('uiCopy.plugin.lifecycleOperation.opening');
  }
}

export function pluginTrustLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.trustBadge) {
    case 'official': return i18n.t('uiCopy.plugin.official');
    case 'verified': return i18n.t('uiCopy.plugin.verified');
    case 'unsigned': return i18n.t('uiCopy.plugin.unsigned');
    case 'community': return i18n.t('uiCopy.plugin.community');
    case 'revoked': return i18n.t('uiCopy.plugin.revoked');
    case 'blocked': return i18n.t('uiCopy.plugin.blocked');
    case 'unavailable': return i18n.t('uiCopy.plugin.unavailable');
    default: return i18n.t('uiCopy.plugin.unavailable');
  }
}
