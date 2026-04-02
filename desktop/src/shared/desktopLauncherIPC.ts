export const DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:launcher-get-snapshot';
export const DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL = 'redeven-desktop:launcher-perform-action';

import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';

export type DesktopTargetKind = 'managed_local' | 'external_local_ui';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_device' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'this_device' | 'remote_device' | 'startup';
export type DesktopLauncherSurface = 'connect_environment' | 'this_device_settings';
export type DesktopEnvironmentEntryKind = 'this_device' | 'external_local_ui';
export type DesktopEnvironmentEntryTag = 'Current' | 'Recent' | 'Saved' | 'This Device' | '';
export type DesktopWelcomeActionKind =
  | 'open_this_device'
  | 'open_remote_device'
  | 'upsert_saved_environment'
  | 'delete_saved_environment'
  | 'return_to_current_device';

export type DesktopWelcomeIssue = Readonly<{
  scope: DesktopWelcomeIssueScope;
  code: string;
  title: string;
  message: string;
  diagnostics_copy: string;
  target_url: string;
}>;

export type DesktopEnvironmentEntry = Readonly<{
  id: string;
  kind: DesktopEnvironmentEntryKind;
  label: string;
  local_ui_url: string;
  secondary_text: string;
  tag: DesktopEnvironmentEntryTag;
  is_current: boolean;
  can_edit: boolean;
  can_delete: boolean;
  last_used_at_ms: number;
}>;

export type DesktopWelcomeSnapshot = Readonly<{
  surface: DesktopLauncherSurface;
  entry_reason: DesktopWelcomeEntryReason;
  current_session_target_kind: DesktopTargetKind | null;
  current_session_local_ui_url: string;
  current_session_label: string;
  current_session_description: string;
  close_action_label: 'Quit' | 'Back to current environment';
  environments: readonly DesktopEnvironmentEntry[];
  suggested_remote_url: string;
  issue: DesktopWelcomeIssue | null;
  settings_surface: DesktopSettingsSurfaceSnapshot;
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
      kind: 'upsert_saved_environment';
      environment_id: string;
      label: string;
      external_local_ui_url: string;
    }
  | {
      kind: 'delete_saved_environment';
      environment_id: string;
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
    case 'return_to_current_device':
      return { kind };
    case 'open_remote_device':
      return {
        kind,
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
      };
    case 'upsert_saved_environment':
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id),
        label: compact((candidate as { label?: unknown }).label),
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
      };
    case 'delete_saved_environment': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
      };
    }
    default:
      return null;
  }
}
