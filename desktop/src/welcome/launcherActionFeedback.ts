import type { DesktopLauncherActionFailure } from '../shared/desktopLauncherIPC';
import type {
  DesktopActionToastAction,
  DesktopActionToastTone,
} from './actionToastModel';

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

function controlPlaneAuthRequiredMessage(failure: DesktopLauncherActionFailure): string {
  const envPublicID = compact(failure.env_public_id);
  if (envPublicID !== '') {
    return 'Desktop needs fresh provider authorization before it can request a one-time Local Environment bootstrap ticket for this Environment.';
  }
  return 'Desktop authorization for this provider expired. Reconnect the provider, then try the action again.';
}

function reconnectControlPlaneAction(
  failure: DesktopLauncherActionFailure,
): DesktopActionToastAction | undefined {
  const providerOrigin = compact(failure.provider_origin);
  if (providerOrigin === '') {
    return undefined;
  }
  return {
    kind: 'reconnect_control_plane',
    label: 'Reconnect Provider',
    provider_origin: providerOrigin,
    provider_id: compact(failure.provider_id) || undefined,
  };
}

export function launcherActionFailurePresentation(
  failure: DesktopLauncherActionFailure,
): LauncherActionFailurePresentation {
  const refreshSnapshot = failure.should_refresh_snapshot === true;
  const delivery = failure.scope === 'dialog' ? 'inline' : 'toast';
  switch (failure.code) {
    case 'session_stale':
      return {
        message: 'That window was already closed. Desktop refreshed the environment list.',
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_opening':
      return {
        message: failure.message,
        tone: 'info',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_offline':
      return {
        message: 'This environment is currently offline in the provider.',
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'runtime_not_started':
      return {
        message: failure.message || 'Start the runtime first, then open this environment.',
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'runtime_not_ready':
      return {
        message: failure.message || 'Runtime is preparing this environment. Try again once it is ready.',
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'environment_status_stale':
      return {
        message: 'Remote status is stale. Refresh the provider to confirm the latest state.',
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'provider_sync_required':
      return {
        message: 'Desktop needs a fresh provider sync before opening this environment.',
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'provider_sync_in_progress':
      return {
        message: 'Desktop is already checking the latest provider status.',
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
        message: failure.message,
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    case 'control_plane_auth_required':
      return {
        title: 'Provider Authorization Expired',
        message: controlPlaneAuthRequiredMessage(failure),
        tone: 'warning',
        refresh_snapshot: refreshSnapshot,
        delivery,
        action: reconnectControlPlaneAction(failure),
        auto_dismiss: false,
      };
    case 'runtime_start_failed':
      return {
        message: failure.message,
        tone: 'error',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
    default:
      return {
        message: failure.message,
        tone: 'error',
        refresh_snapshot: refreshSnapshot,
        delivery,
      };
  }
}
