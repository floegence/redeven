import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';
import type { DesktopI18n, DesktopTranslationKey, TranslationParams } from '../shared/i18n';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function failureParams(failure: DesktopOperationFailurePresentation): TranslationParams {
  return {
    target: compact(failure.target_label) || 'Runtime',
    reason: compact(failure.detail),
  };
}

function failureTitleKey(failure: DesktopOperationFailurePresentation): DesktopTranslationKey | undefined {
  if (failure.title_key) {
    return failure.title_key;
  }
  switch (failure.code) {
    case 'ssh_authentication_failed':
      return 'progress.sshAuthenticationFailedTitle';
    case 'ssh_connection_failed':
      return 'progress.sshConnectionFailedTitle';
    case 'ssh_connection_interrupted':
      return 'progress.sshConnectionInterruptedTitle';
    case 'ssh_runtime_status_unavailable':
      return 'progress.sshRuntimeStatusUnavailableTitle';
    case 'ssh_runtime_install_failed':
      return 'progress.sshRuntimeInstallFailedTitle';
    case 'ssh_upload_directory_unavailable':
      return 'progress.sshUploadDirectoryUnavailableTitle';
    case 'local_runtime_launch_failed':
    case 'ssh_runtime_launch_failed':
      return 'progress.runtimeStartFailedTitle';
    case 'gateway_package_prepare_failed':
      return 'progress.gatewayPackagePrepareFailedTitle';
    case 'runtime_package_prepare_failed':
      return 'progress.runtimePackagePrepareFailedTitle';
    case 'redevplugin_release_asset_forbidden':
    case 'redevplugin_release_asset_unavailable':
    case 'redevplugin_release_asset_timeout':
      return 'progress.redevpluginReleaseAssetFailedTitle';
    case 'reinstall_direct_channel_failed':
      return 'progress.reinstallDirectChannelFailedTitle';
    case 'reinstall_package_batch_failed':
      return 'progress.reinstallPackageBatchFailedTitle';
    case 'reinstall_filesystem_failed':
      return 'progress.reinstallFilesystemFailedTitle';
    case 'reinstall_runtime_install_failed':
      return 'progress.reinstallRuntimeInstallFailedTitle';
    case 'reinstall_runtime_start_failed':
      return 'progress.reinstallRuntimeStartFailedTitle';
    case 'reinstall_runtime_verification_failed':
      return 'progress.reinstallRuntimeVerificationFailedTitle';
    case 'reinstall_runtime_access_failed':
      return 'progress.reinstallRuntimeAccessFailedTitle';
    case 'local_runtime_stop_failed':
    case 'container_runtime_stop_failed':
    case 'ssh_runtime_stop_failed':
      return 'progress.runtimeStopFailedTitle';
    case 'runtime_cleanup_failed':
      return 'progress.runtimeCleanupFailedTitle';
    case 'confirmation_required':
      return 'progress.runtimeConfirmationRequiredTitle';
    case 'runtime_host_command_failed':
    case 'runtime_host_command_timeout':
      return 'progress.runtimeHostCommandFailedTitle';
    case 'runtime_update_required':
      return 'runtimeMessage.runtimeUpdateRequired';
    case 'runtime_access_verification_failed':
      return 'progress.runtimeAccessVerificationFailedTitle';
    case 'desktop_update_required':
      return 'runtimeMessage.desktopUpdateRequired';
    case 'environment_open_failed':
      return 'progress.environmentOpenFailedTitle';
    case 'provider_link_failed':
      return 'runtimeMessage.providerLinkFailedTitle';
    case 'workspace_engine_prepare_failed':
      return 'progress.workspaceEnginePrepareFailedTitle';
    case 'operation_canceled':
      return 'progress.titleStartupCanceled';
    case 'operation_failed':
      return 'progress.operationFailedTitle';
  }
}

function failureSummaryKey(failure: DesktopOperationFailurePresentation): DesktopTranslationKey | undefined {
  if (failure.summary_key) {
    return failure.summary_key;
  }
  switch (failure.code) {
    case 'ssh_authentication_failed':
      return 'progress.sshAuthenticationFailedSummary';
    case 'ssh_connection_failed':
      return 'progress.sshConnectionFailedSummary';
    case 'ssh_connection_interrupted':
      return 'progress.sshConnectionInterruptedSummary';
    case 'ssh_runtime_status_unavailable':
      return 'progress.sshRuntimeStatusUnavailableSummary';
    case 'ssh_runtime_install_failed':
      return 'progress.sshRuntimeInstallFailedSummary';
    case 'ssh_upload_directory_unavailable':
      return 'progress.sshUploadDirectoryUnavailableSummary';
    case 'local_runtime_launch_failed':
    case 'ssh_runtime_launch_failed':
      return 'progress.runtimeStartFailedSummary';
    case 'gateway_package_prepare_failed':
      return 'progress.gatewayPackagePrepareFailedSummary';
    case 'runtime_package_prepare_failed':
      return 'progress.runtimePackagePrepareFailedSummary';
    case 'redevplugin_release_asset_forbidden':
    case 'redevplugin_release_asset_unavailable':
    case 'redevplugin_release_asset_timeout':
      return 'progress.redevpluginReleaseAssetFailedSummary';
    case 'reinstall_direct_channel_failed':
      return 'progress.reinstallDirectChannelFailedSummary';
    case 'reinstall_package_batch_failed':
      return 'progress.reinstallPackageBatchFailedSummary';
    case 'reinstall_filesystem_failed':
      return 'progress.reinstallFilesystemFailedSummary';
    case 'reinstall_runtime_install_failed':
      return 'progress.reinstallRuntimeInstallFailedSummary';
    case 'reinstall_runtime_start_failed':
      return 'progress.reinstallRuntimeStartFailedSummary';
    case 'reinstall_runtime_verification_failed':
      return 'progress.reinstallRuntimeVerificationFailedSummary';
    case 'reinstall_runtime_access_failed':
      return 'progress.reinstallRuntimeAccessFailedSummary';
    case 'local_runtime_stop_failed':
    case 'container_runtime_stop_failed':
    case 'ssh_runtime_stop_failed':
      return 'progress.runtimeStopFailedSummary';
    case 'runtime_cleanup_failed':
      return 'progress.runtimeCleanupFailedSummary';
    case 'confirmation_required':
      return 'progress.runtimeConfirmationRequiredSummary';
    case 'runtime_host_command_failed':
    case 'runtime_host_command_timeout':
      return 'progress.runtimeHostCommandFailedSummary';
    case 'environment_open_failed':
      return 'progress.environmentOpenFailedSummary';
    case 'provider_link_failed':
      return 'runtimeMessage.providerLinkFailedDetail';
    case 'workspace_engine_prepare_failed':
      return 'progress.workspaceEnginePrepareFailedSummary';
    case 'operation_canceled':
      return 'progress.detailStartupCanceled';
    case 'operation_failed':
      return 'progress.operationFailedSummary';
    case 'runtime_update_required':
    case 'desktop_update_required':
      return undefined;
    case 'runtime_access_verification_failed':
      return 'progress.runtimeAccessVerificationFailedSummary';
  }
}

export function localizedOperationFailureTitle(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): string {
  const key = failureTitleKey(failure);
  return key ? i18n.t(key, failureParams(failure)) : compact(failure.title);
}

export function localizedOperationFailureSummary(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): string {
  if (!failure.summary_key && !compact(failure.target_label)) {
    return compact(failure.summary);
  }
  const key = failureSummaryKey(failure);
  return key ? i18n.t(key, failureParams(failure)) : compact(failure.summary);
}

export function localizedOperationFailureCompactSummary(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): string {
  const key = failureSummaryKey(failure);
  return key ? i18n.t(key, failureParams(failure)) : compact(failure.summary);
}

export function localizedOperationFailureDetail(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): string {
  if (failure.detail_key) {
    return i18n.t(failure.detail_key, failureParams(failure));
  }
  if (failure.code === 'ssh_connection_interrupted') {
    return i18n.t('progress.sshConnectionInterruptedDetail');
  }
  if (failure.code === 'ssh_upload_directory_unavailable') {
    return i18n.t('progress.sshUploadDirectoryUnavailableDetail');
  }
  if (failure.code === 'confirmation_required') {
    return i18n.t('progress.runtimeConfirmationRequiredDetail');
  }
  if (failure.code === 'runtime_package_prepare_failed') {
    return i18n.t('progress.runtimePackagePrepareFailedDetail');
  }
  if (failure.code === 'redevplugin_release_asset_forbidden'
    || failure.code === 'redevplugin_release_asset_unavailable'
    || failure.code === 'redevplugin_release_asset_timeout') {
    return i18n.t('progress.redevpluginReleaseAssetFailedDetail');
  }
  return i18n.locale === 'en-US' ? compact(failure.detail) : '';
}

export function localizedOperationFailureRecoveryHint(
  i18n: DesktopI18n,
  failure: DesktopOperationFailurePresentation,
): string {
  if (failure.recovery_hint_key) {
    return i18n.t(failure.recovery_hint_key, failureParams(failure));
  }
  if (failure.code === 'ssh_authentication_failed') {
    return i18n.t('progress.sshAuthenticationFailedRecoveryHint');
  }
  if (failure.code === 'ssh_connection_interrupted') {
    return i18n.t('progress.sshConnectionInterruptedRecoveryHint');
  }
  if (failure.code === 'ssh_upload_directory_unavailable') {
    return i18n.t('progress.sshUploadDirectoryUnavailableRecoveryHint');
  }
  if (failure.code === 'confirmation_required') {
    return i18n.t('progress.runtimeConfirmationRequiredRecoveryHint');
  }
  if (failure.code === 'runtime_package_prepare_failed') {
    return i18n.t('progress.runtimePackagePrepareFailedRecoveryHint');
  }
  if (failure.code === 'redevplugin_release_asset_forbidden'
    || failure.code === 'redevplugin_release_asset_unavailable'
    || failure.code === 'redevplugin_release_asset_timeout') {
    return i18n.t('progress.redevpluginReleaseAssetFailedRecoveryHint');
  }
  return i18n.locale === 'en-US' ? compact(failure.recovery_hint) : '';
}
