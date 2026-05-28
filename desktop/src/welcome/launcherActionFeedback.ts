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
