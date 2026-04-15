import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionFailure,
} from '../shared/desktopLauncherIPC';

export type EnvironmentActionNotice = Readonly<{
  tone: 'info' | 'warning';
  message: string;
  updated_at_ms: number;
}>;

export type LauncherActionFailurePresentation = Readonly<{
  global_message: string;
  notice_message: string;
  notice_tone: EnvironmentActionNotice['tone'];
  refresh_snapshot: boolean;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function environmentNoticeKey(environmentID: string): string {
  return `environment:${compact(environmentID)}`;
}

export function providerEnvironmentNoticeKey(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): string {
  return `provider:${compact(providerOrigin)}|${compact(providerID)}|${compact(envPublicID)}`;
}

export function noticeKeysForEnvironment(environment: DesktopEnvironmentEntry): readonly string[] {
  const keys = [environmentNoticeKey(environment.id)];
  if (environment.provider_origin && environment.provider_id && environment.env_public_id) {
    keys.push(
      providerEnvironmentNoticeKey(
        environment.provider_origin,
        environment.provider_id,
        environment.env_public_id,
      ),
    );
  }
  return keys;
}

export function noticeKeysForProviderEnvironment(
  providerOrigin: string,
  providerID: string,
  envPublicID: string,
): readonly string[] {
  return [providerEnvironmentNoticeKey(providerOrigin, providerID, envPublicID)];
}

export function dedupeNoticeKeys(keys: readonly string[]): readonly string[] {
  return [...new Set(keys.filter((value) => compact(value) !== ''))];
}

export function launcherActionFailurePresentation(
  failure: DesktopLauncherActionFailure,
  noticeKeys: readonly string[] = [],
): LauncherActionFailurePresentation {
  const refreshSnapshot = failure.should_refresh_snapshot === true;
  const cleanedNoticeKeys = dedupeNoticeKeys(noticeKeys);
  const globalMessage = cleanedNoticeKeys.length > 0 ? '' : failure.message;
  switch (failure.code) {
    case 'session_stale':
      return {
        global_message: globalMessage,
        notice_message: 'That window was already closed. Desktop refreshed the environment list.',
        notice_tone: 'info',
        refresh_snapshot: refreshSnapshot,
      };
    case 'environment_offline':
      return {
        global_message: globalMessage,
        notice_message: 'This environment is currently offline in the provider.',
        notice_tone: 'warning',
        refresh_snapshot: refreshSnapshot,
      };
    case 'environment_status_stale':
      return {
        global_message: globalMessage,
        notice_message: 'Remote status is stale. Refresh the provider to confirm the latest state.',
        notice_tone: 'info',
        refresh_snapshot: refreshSnapshot,
      };
    case 'provider_sync_required':
      return {
        global_message: globalMessage,
        notice_message: 'Desktop needs a fresh provider sync before opening this environment.',
        notice_tone: 'info',
        refresh_snapshot: refreshSnapshot,
      };
    case 'provider_sync_in_progress':
      return {
        global_message: globalMessage,
        notice_message: 'Desktop is already checking the latest provider status.',
        notice_tone: 'info',
        refresh_snapshot: refreshSnapshot,
      };
    case 'environment_missing':
    case 'environment_in_use':
    case 'environment_route_unavailable':
    case 'control_plane_missing':
    case 'control_plane_environment_missing':
    case 'provider_environment_removed':
    case 'control_plane_auth_required':
    case 'provider_unreachable':
    case 'provider_invalid_response':
      return {
        global_message: globalMessage,
        notice_message: failure.message,
        notice_tone: 'warning',
        refresh_snapshot: refreshSnapshot,
      };
    default:
      return {
        global_message: failure.message,
        notice_message: '',
        notice_tone: 'warning',
        refresh_snapshot: refreshSnapshot,
      };
  }
}
