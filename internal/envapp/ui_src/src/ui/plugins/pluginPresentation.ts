import type { PluginInstallExecutionProjection, PluginInventoryItem, PluginPendingCommandType } from './pluginTypes';
import type { I18nHelpers } from '../i18n';

export const PLUGIN_MOBILE_TOUCH_TARGET_CLASS = 'min-h-[46px] min-w-[46px] sm:min-h-0 sm:min-w-0';
export const PLUGIN_PACKAGE_DIALOG_CLASS = 'h-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[34rem] rounded-xl bg-background text-foreground';
export const PLUGIN_ENTER_MOTION_CLASS = 'redeven-plugin-motion redeven-plugin-enter-up animate-in fade-in duration-200 ease-out motion-reduce:animate-none';
export const PLUGIN_PRESS_MOTION_CLASS = 'redeven-plugin-motion transition-[background-color,border-color,color,box-shadow,opacity] duration-120 ease-out motion-reduce:transition-none';
export const PLUGIN_UPDATE_ACTION_CLASS = 'bg-[var(--redeven-status-info-foreground)] text-[var(--background)] enabled:hover:bg-[color-mix(in_srgb,var(--redeven-status-info-foreground)_88%,var(--foreground))]';

export type PluginPrimaryAction =
  | 'install'
  | 'enable'
  | 'open'
  | 'review_update'
  | 'view_permissions'
  | 'view_policy'
  | 'view_runtime'
  | 'view_attention'
  | 'view_diagnostics'
  | 'view_details';

export type PluginPresentation = Readonly<{
  primaryAction: PluginPrimaryAction;
  tone: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  canOpenSurface: boolean;
  canDisable: boolean;
  canCheckForUpdate: boolean;
  canUninstall: boolean;
}>;

export function presentPlugin(item: PluginInventoryItem): PluginPresentation {
  const installed = Boolean(item.pluginInstanceID);
  const executionBlocked = item.externalPackage?.executionApproval.state === 'policy_blocked'
    || item.externalPackage?.executionApproval.state === 'pending';
  const lifecycleAllowsOpening = item.lifecycleState === 'enabled'
    || item.lifecycleState === 'update_available';
  const attentionBlocksOpening = item.attentionReason === 'catalog_revoked'
    || item.attentionReason === 'catalog_disabled'
    || item.attentionReason === 'policy_restricted'
    || item.attentionReason === 'permission_required'
    || item.attentionReason === 'runtime_missing'
    || item.attentionReason === 'diagnostic_error'
    || item.attentionReason === 'install_unavailable';
  const canOpen = installed
    && lifecycleAllowsOpening
    && Boolean(item.defaultLaunchTarget)
    && !executionBlocked
    && !attentionBlocksOpening;

  let primaryAction: PluginPrimaryAction;
  let tone: PluginPresentation['tone'];
  if (executionBlocked || item.attentionReason === 'catalog_revoked' || item.attentionReason === 'catalog_disabled') {
    primaryAction = 'view_attention';
    tone = 'error';
  } else if (!installed) {
    primaryAction = item.lifecycleState === 'not_installed' ? 'install' : 'view_details';
    tone = item.lifecycleState === 'not_installed' ? 'neutral' : 'warning';
  } else if (item.attentionReason === 'policy_restricted') {
    primaryAction = 'view_policy';
    tone = 'warning';
  } else if (item.lifecycleState === 'update_available' || item.attentionReason === 'update_required') {
    primaryAction = 'review_update';
    tone = 'info';
  } else if (item.attentionReason === 'permission_required') {
    primaryAction = 'view_permissions';
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
    primaryAction = 'open';
    tone = 'success';
  } else {
    primaryAction = 'view_details';
    tone = item.lifecycleState === 'enabled' ? 'warning' : 'neutral';
  }

  return Object.freeze({
    primaryAction,
    tone,
    canOpenSurface: canOpen,
    canDisable: installed && Boolean(item.canDisable),
    canCheckForUpdate: installed && !executionBlocked && Boolean(item.externalPackage || item.officialCatalog),
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

export function pluginPendingCommandLabel(
  command: PluginPendingCommandType,
  i18n: I18nHelpers,
  installObservation?: PluginInstallExecutionProjection['observation'],
): string {
  switch (command) {
    case 'install': return i18n.t(installObservation === 'finalizing'
      ? 'uiCopy.plugin.installOperation.finalizing'
      : 'uiCopy.plugin.installOperation.starting');
    case 'update': return i18n.t('uiCopy.plugin.lifecycleOperation.updating');
    case 'enable': return i18n.t('uiCopy.plugin.lifecycleOperation.enabling');
    case 'disable': return i18n.t('uiCopy.plugin.lifecycleOperation.disabling');
    case 'uninstall': return i18n.t('uiCopy.plugin.lifecycleOperation.uninstalling');
    case 'grant_permission': return i18n.t('uiCopy.plugin.lifecycleOperation.grantingPermission');
    case 'revoke_permission': return i18n.t('uiCopy.plugin.lifecycleOperation.revokingPermission');
    case 'open_surface': return i18n.t('uiCopy.plugin.lifecycleOperation.opening');
  }
}

/** Labels which may replace a primary action while the host completes a lifecycle command. */
export function pluginPendingActionLabels(i18n: I18nHelpers): string[] {
  return (['install', 'enable', 'disable', 'uninstall', 'grant_permission', 'revoke_permission', 'open_surface'] as const)
    .flatMap(command => command === 'install'
      ? [pluginPendingCommandLabel(command, i18n), pluginPendingCommandLabel(command, i18n, 'finalizing')]
      : [pluginPendingCommandLabel(command, i18n)]);
}

export function pluginSourceLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  return i18n.t(item.sourceKind === 'official' ? 'uiCopy.plugin.official' : 'uiCopy.plugin.community');
}
