export const DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:launcher-get-snapshot';
export const DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL = 'redeven-desktop:launcher-perform-action';

export type DesktopTargetKind = 'managed_local' | 'external_local_ui';
export type DesktopSharePreset = 'this_device' | 'local_network' | 'custom';
export type DesktopLinkState = 'idle' | 'pending' | 'connected';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_device' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'this_device' | 'remote_device' | 'startup';
export type DesktopWelcomeActionKind =
  | 'open_this_device'
  | 'open_remote_device'
  | 'open_advanced_settings'
  | 'return_to_current_device';

export type DesktopWelcomeIssue = Readonly<{
  scope: DesktopWelcomeIssueScope;
  code: string;
  title: string;
  message: string;
  diagnostics_copy: string;
  target_url: string;
}>;

export type DesktopRecentDeviceCard = Readonly<{
  local_ui_url: string;
  is_active_session: boolean;
}>;

export type DesktopWelcomeSnapshot = Readonly<{
  entry_reason: DesktopWelcomeEntryReason;
  current_session_target_kind: DesktopTargetKind | null;
  current_session_local_ui_url: string;
  current_session_label: string;
  current_session_description: string;
  close_action_label: 'Quit' | 'Back to current device';
  this_device_local_ui_url: string;
  this_device_share_preset: DesktopSharePreset;
  this_device_share_label: string;
  this_device_share_description: string;
  this_device_link_state: DesktopLinkState;
  this_device_link_label: string;
  this_device_link_description: string;
  recent_devices: readonly DesktopRecentDeviceCard[];
  suggested_remote_url: string;
  issue: DesktopWelcomeIssue | null;
}>;

export type DesktopLauncherActionRequest = Readonly<
  | {
      kind: 'open_this_device';
    }
  | {
      kind: 'open_remote_device';
      external_local_ui_url: string;
    }
  | {
      kind: 'open_advanced_settings';
    }
  | {
      kind: 'return_to_current_device';
    }
>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopLauncherActionRequest(value: unknown): DesktopLauncherActionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopLauncherActionRequest>;
  const kind = compact(candidate.kind) as DesktopWelcomeActionKind;
  switch (kind) {
    case 'open_this_device':
    case 'open_advanced_settings':
    case 'return_to_current_device':
      return { kind };
    case 'open_remote_device': {
      const externalLocalUIURL = compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url);
      return {
        kind,
        external_local_ui_url: externalLocalUIURL,
      };
    }
    default:
      return null;
  }
}
