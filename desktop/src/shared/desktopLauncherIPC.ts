import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';
import type { DesktopSavedEnvironmentSource } from './desktopConnectionTypes';
import type { DesktopControlPlaneSummary } from './controlPlaneProvider';
import type { DesktopSSHEnvironmentDetails } from './desktopSSH';

export const DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:launcher-get-snapshot';
export const DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL = 'redeven-desktop:launcher-perform-action';
export const DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL = 'redeven-desktop:launcher-snapshot-updated';

export type DesktopTargetKind = 'managed_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_environment' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'managed_environment' | 'remote_environment' | 'startup';
export type DesktopLauncherSurface = 'connect_environment' | 'managed_environment_settings';
export type DesktopEnvironmentEntryKind = 'managed_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopEnvironmentEntryTag = 'Open' | 'Recent' | 'Saved' | 'Managed' | '';
export type DesktopEnvironmentEntryCategory = 'managed' | 'open_unsaved' | DesktopSavedEnvironmentSource;
export type DesktopManagedEnvironmentRoute = 'local_host' | 'remote_desktop';
export type DesktopLauncherActionKind =
  | 'open_managed_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'start_control_plane_connect'
  | 'open_managed_environment_settings'
  | 'focus_environment_window'
  | 'open_control_plane_environment'
  | 'refresh_control_plane'
  | 'delete_control_plane'
  | 'upsert_managed_local_environment'
  | 'upsert_saved_environment'
  | 'upsert_saved_ssh_environment'
  | 'delete_saved_environment'
  | 'delete_saved_ssh_environment'
  | 'close_launcher_or_quit';

export type DesktopWelcomeIssue = Readonly<{
  scope: DesktopWelcomeIssueScope;
  code: string;
  title: string;
  message: string;
  diagnostics_copy: string;
  target_url: string;
  ssh_details?: DesktopSSHEnvironmentDetails;
}>;

export type DesktopOpenEnvironmentWindow = Readonly<{
  session_key: string;
  target_kind: DesktopTargetKind;
  environment_id: string;
  label: string;
  local_ui_url: string;
}>;

export type DesktopEnvironmentEntry = Readonly<{
  id: string;
  kind: DesktopEnvironmentEntryKind;
  label: string;
  local_ui_url: string;
  secondary_text: string;
  managed_environment_kind?: 'local' | 'controlplane';
  managed_environment_name?: string;
  managed_local_ui_bind?: string;
  managed_local_ui_password_configured?: boolean;
  managed_has_local_hosting?: boolean;
  managed_has_remote_desktop?: boolean;
  managed_preferred_open_route?: 'auto' | DesktopManagedEnvironmentRoute;
  default_open_route?: DesktopManagedEnvironmentRoute;
  open_local_session_key?: string;
  open_remote_session_key?: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  ssh_details?: DesktopSSHEnvironmentDetails;
  tag: DesktopEnvironmentEntryTag;
  category: DesktopEnvironmentEntryCategory;
  is_open: boolean;
  open_session_key: string;
  open_action_label: 'Open' | 'Focus';
  can_edit: boolean;
  can_delete: boolean;
  can_save: boolean;
  last_used_at_ms: number;
}>;

export type DesktopWelcomeSnapshot = Readonly<{
  surface: DesktopLauncherSurface;
  entry_reason: DesktopWelcomeEntryReason;
  close_action_label: 'Quit' | 'Close Launcher';
  open_windows: readonly DesktopOpenEnvironmentWindow[];
  environments: readonly DesktopEnvironmentEntry[];
  control_planes: readonly DesktopControlPlaneSummary[];
  suggested_remote_url: string;
  issue: DesktopWelcomeIssue | null;
  settings_surface: DesktopSettingsSurfaceSnapshot;
}>;

export type DesktopLauncherActionRequest = Readonly<
  | {
      kind: 'open_managed_environment';
      environment_id: string;
      route?: 'auto' | DesktopManagedEnvironmentRoute;
    }
  | {
      kind: 'open_remote_environment';
      external_local_ui_url: string;
      environment_id?: string;
      label?: string;
    }
  | ({
      kind: 'open_ssh_environment';
      environment_id?: string;
      label?: string;
    } & DesktopSSHEnvironmentDetails)
  | {
      kind: 'start_control_plane_connect';
      provider_origin: string;
    }
  | {
      kind: 'open_managed_environment_settings';
      environment_id: string;
    }
  | {
      kind: 'focus_environment_window';
      session_key: string;
    }
  | {
      kind: 'open_control_plane_environment';
      provider_origin: string;
      provider_id: string;
      env_public_id: string;
    }
  | {
      kind: 'refresh_control_plane';
      provider_origin: string;
      provider_id: string;
    }
  | {
      kind: 'delete_control_plane';
      provider_origin: string;
      provider_id: string;
    }
  | {
      kind: 'upsert_managed_local_environment';
      environment_id?: string;
      environment_name: string;
      label: string;
      local_ui_bind: string;
      local_ui_password: string;
      local_ui_password_mode: 'keep' | 'replace' | 'clear';
      remote_access_enabled?: boolean;
      provider_origin?: string;
      provider_id?: string;
      env_public_id?: string;
      preferred_open_route?: 'auto' | DesktopManagedEnvironmentRoute;
    }
  | {
      kind: 'upsert_saved_environment';
      environment_id: string;
      label: string;
      external_local_ui_url: string;
    }
  | ({
      kind: 'upsert_saved_ssh_environment';
      environment_id: string;
      label: string;
    } & DesktopSSHEnvironmentDetails)
  | {
      kind: 'delete_saved_environment';
      environment_id: string;
    }
  | {
      kind: 'delete_saved_ssh_environment';
      environment_id: string;
    }
  | {
      kind: 'close_launcher_or_quit';
    }
>;

export type DesktopLauncherActionResult = Readonly<{
  outcome:
    | 'opened_environment_window'
    | 'focused_environment_window'
    | 'opened_utility_window'
    | 'focused_utility_window'
    | 'started_control_plane_connect'
    | 'refreshed_control_plane'
    | 'deleted_control_plane'
    | 'saved_environment'
    | 'deleted_environment'
    | 'closed_launcher'
    | 'quit_app';
  session_key?: string;
  utility_window_kind?: 'launcher' | 'managed_environment_settings';
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopLauncherActionRequest(value: unknown): DesktopLauncherActionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopLauncherActionRequest>;
  const kind = compact(candidate.kind) as DesktopLauncherActionKind;
  switch (kind) {
    case 'close_launcher_or_quit':
      return { kind };
    case 'open_managed_environment':
    case 'open_managed_environment_settings': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        ...(kind === 'open_managed_environment'
          ? {
              route: (() => {
                const route = compact((candidate as { route?: unknown }).route);
                if (route === 'local_host' || route === 'remote_desktop') {
                  return route;
                }
                return 'auto';
              })(),
            }
          : {}),
      };
    }
    case 'open_remote_environment':
      return {
        kind,
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        label: compact((candidate as { label?: unknown }).label) || undefined,
      };
    case 'open_ssh_environment':
      {
        const sshPortText = compact((candidate as { ssh_port?: unknown }).ssh_port);
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        label: compact((candidate as { label?: unknown }).label) || undefined,
        ssh_destination: compact((candidate as { ssh_destination?: unknown }).ssh_destination),
        ssh_port: (candidate as { ssh_port?: unknown }).ssh_port == null || sshPortText === ''
          ? null
          : Number.parseInt(sshPortText, 10),
        remote_install_dir: compact((candidate as { remote_install_dir?: unknown }).remote_install_dir),
        bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
        release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
      };
      }
    case 'start_control_plane_connect':
      return {
        kind,
        provider_origin: compact((candidate as { provider_origin?: unknown }).provider_origin),
      };
    case 'upsert_managed_local_environment':
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        environment_name: compact((candidate as { environment_name?: unknown }).environment_name),
        label: compact((candidate as { label?: unknown }).label),
        local_ui_bind: compact((candidate as { local_ui_bind?: unknown }).local_ui_bind),
        local_ui_password: String((candidate as { local_ui_password?: unknown }).local_ui_password ?? ''),
        local_ui_password_mode: compact(
          (candidate as { local_ui_password_mode?: unknown }).local_ui_password_mode,
        ) as 'keep' | 'replace' | 'clear',
        remote_access_enabled: (candidate as { remote_access_enabled?: unknown }).remote_access_enabled === true,
        provider_origin: compact((candidate as { provider_origin?: unknown }).provider_origin) || undefined,
        provider_id: compact((candidate as { provider_id?: unknown }).provider_id) || undefined,
        env_public_id: compact((candidate as { env_public_id?: unknown }).env_public_id) || undefined,
        preferred_open_route: (() => {
          const route = compact((candidate as { preferred_open_route?: unknown }).preferred_open_route);
          if (route === 'local_host' || route === 'remote_desktop') {
            return route;
          }
          return 'auto';
        })(),
      };
    case 'focus_environment_window': {
      const sessionKey = compact((candidate as { session_key?: unknown }).session_key);
      if (sessionKey === '') {
        return null;
      }
      return {
        kind,
        session_key: sessionKey,
      };
    }
    case 'open_control_plane_environment':
    case 'refresh_control_plane':
    case 'delete_control_plane': {
      const providerOrigin = compact((candidate as { provider_origin?: unknown }).provider_origin);
      const providerID = compact((candidate as { provider_id?: unknown }).provider_id);
      if (providerOrigin === '' || providerID === '') {
        return null;
      }
      if (kind === 'delete_control_plane' || kind === 'refresh_control_plane') {
        return {
          kind,
          provider_origin: providerOrigin,
          provider_id: providerID,
        };
      }
      const envPublicID = compact((candidate as { env_public_id?: unknown }).env_public_id);
      if (envPublicID === '') {
        return null;
      }
      return {
        kind,
        provider_origin: providerOrigin,
        provider_id: providerID,
        env_public_id: envPublicID,
      };
    }
    case 'upsert_saved_environment':
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id),
        label: compact((candidate as { label?: unknown }).label),
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
      };
    case 'upsert_saved_ssh_environment':
      {
        const sshPortText = compact((candidate as { ssh_port?: unknown }).ssh_port);
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id),
        label: compact((candidate as { label?: unknown }).label),
        ssh_destination: compact((candidate as { ssh_destination?: unknown }).ssh_destination),
        ssh_port: (candidate as { ssh_port?: unknown }).ssh_port == null || sshPortText === ''
          ? null
          : Number.parseInt(sshPortText, 10),
        remote_install_dir: compact((candidate as { remote_install_dir?: unknown }).remote_install_dir),
        bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
        release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
      };
      }
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
    case 'delete_saved_ssh_environment': {
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
