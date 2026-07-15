import type { DesktopLauncherActionFailure } from '../shared/desktopLauncherIPC';
import type { DesktopI18n } from '../shared/i18n';
import type {
  DesktopActionToastAction,
  DesktopActionToastTone,
} from './actionToastModel';
import {
  localizedOperationFailureSummary,
  localizedOperationFailureTitle,
} from './operationFailureI18n';

export type LauncherActionFailurePresentation = Readonly<{
  title?: string;
  message: string;
  tone: DesktopActionToastTone;
  refresh_snapshot: boolean;
  delivery: 'toast' | 'inline';
  action?: DesktopActionToastAction;
  auto_dismiss?: boolean;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function controlPlaneAuthRequiredMessage(
  i18n: DesktopI18n,
  failure: DesktopLauncherActionFailure,
): string {
  const envPublicID = compact(failure.env_public_id);
  if (envPublicID !== '') {
    return i18n.t('toast.providerAuthorizationRequired');
  }
  return i18n.t('toast.providerAuthorizationExpired');
}

function reconnectControlPlaneAction(
  i18n: DesktopI18n,
  failure: DesktopLauncherActionFailure,
): DesktopActionToastAction | undefined {
  const providerOrigin = compact(failure.provider_origin);
  if (providerOrigin === '') {
    return undefined;
  }
  return {
    kind: 'reconnect_control_plane',
    label: i18n.t('environmentAction.reconnectProvider'),
    provider_origin: providerOrigin,
    provider_id: compact(failure.provider_id) || undefined,
  };
}

function gatewayFailureMessage(i18n: DesktopI18n, failure: DesktopLauncherActionFailure): string {
  const detail = compact(failure.message);
  const detailOr = (key: Parameters<DesktopI18n['t']>[0]) => (
    i18n.locale === 'en-US' && detail ? detail : i18n.t(key)
  );
  switch (failure.code) {
    case 'gateway_not_manageable':
      return detailOr('toast.gatewayNotManageable');
    case 'gateway_service_unreachable':
      return detailOr('toast.gatewayServiceUnreachable');
    case 'gateway_container_unavailable':
      return detailOr('toast.gatewayContainerUnavailable');
    case 'gateway_bridge_unavailable':
      return detailOr('toast.gatewayBridgeUnavailable');
    case 'gateway_service_start_failed':
      return detailOr('toast.gatewayServiceStartFailed');
    case 'gateway_service_stop_failed':
      return detailOr('toast.gatewayServiceStopFailed');
    case 'gateway_service_restart_failed':
      return detailOr('toast.gatewayServiceRestartFailed');
    case 'gateway_service_update_failed':
      return detailOr('toast.gatewayServiceUpdateFailed');
    case 'gateway_catalog_failed':
      return detailOr('toast.gatewayCatalogFailed');
    case 'gateway_start_required':
      return detailOr('toast.gatewayStartRequired');
    default:
      return detail || i18n.t('toast.gatewayActionFailed');
  }
}

export function launcherActionFailurePresentation(
  i18n: DesktopI18n,
  failure: DesktopLauncherActionFailure,
): LauncherActionFailurePresentation {
  const refreshSnapshot = failure.should_refresh_snapshot === true;
  const delivery = failure.scope === 'dialog' ? 'inline' : 'toast';
  const structured = failure.failure;
  if (structured) {
    return {
      title: localizedOperationFailureTitle(i18n, structured),
      message: localizedOperationFailureSummary(i18n, structured),
      tone: structured.severity,
      refresh_snapshot: refreshSnapshot,
      delivery,
    };
  }
  switch (failure.code) {
    case 'runtime_lifecycle_in_progress':
      return {
        message: i18n.t('toast.runtimeLifecycleInProgress'),
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'session_stale':
      return {
        message: i18n.t('toast.sessionStale'),
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_opening':
      return {
        message: i18n.locale === 'en-US'
          ? compact(failure.message) || i18n.t('toast.openingStopping')
          : i18n.t('toast.openingStopping'),
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_offline':
      return {
        message: i18n.t('toast.environmentOffline'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'runtime_not_started':
      return {
        message: i18n.t('toast.runtimeNotStarted'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'runtime_not_ready':
      return {
        message: i18n.t('toast.runtimeNotReady'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_status_stale':
      return {
        message: i18n.t('toast.environmentStatusStale'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'provider_sync_required':
      return {
        message: i18n.t('toast.providerSyncRequired'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'provider_sync_in_progress':
      return {
        message: i18n.t('toast.providerSyncInProgress'),
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_missing':
    case 'environment_in_use':
    case 'environment_route_unavailable':
    case 'control_plane_missing':
    case 'control_plane_environment_missing':
    case 'provider_environment_removed':
    case 'provider_unreachable':
    case 'provider_invalid_response':
      return {
        message: i18n.locale === 'en-US'
          ? compact(failure.message) || i18n.t('runtimeMessage.providerLinkFailedDetail')
          : i18n.t('runtimeMessage.providerLinkFailedDetail'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'provider_link_failed':
      return {
        message: i18n.t('runtimeMessage.providerLinkFailedDetail'),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'control_plane_auth_required':
      return {
        title: i18n.t('toast.providerAuthorizationExpiredTitle'),
        message: controlPlaneAuthRequiredMessage(i18n, failure),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
        action: reconnectControlPlaneAction(i18n, failure),
        auto_dismiss: false,
      };
    case 'runtime_start_failed':
      return {
        message: i18n.t('progress.runtimeStartFailedSummary'),
        tone: 'error',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'gateway_start_required':
      return {
        message: gatewayFailureMessage(i18n, failure),
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'gateway_not_manageable':
      return {
        message: gatewayFailureMessage(i18n, failure),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'gateway_service_unreachable':
    case 'gateway_container_unavailable':
    case 'gateway_bridge_unavailable':
    case 'gateway_catalog_failed':
      return {
        message: gatewayFailureMessage(i18n, failure),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'gateway_service_start_failed':
    case 'gateway_service_stop_failed':
    case 'gateway_service_restart_failed':
    case 'gateway_service_update_failed':
      return {
        message: gatewayFailureMessage(i18n, failure),
        tone: 'error',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    default:
      return {
        message: i18n.locale === 'en-US'
          ? compact(failure.message) || i18n.t('toast.actionFailedFallback')
          : i18n.t('toast.actionFailedFallback'),
        tone: 'error',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
  }
}
