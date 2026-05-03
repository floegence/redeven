import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';
import type { DesktopSavedEnvironmentSource } from './desktopConnectionTypes';
import type { DesktopControlPlaneSummary } from './controlPlaneProvider';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import type { DesktopSSHEnvironmentDetails } from './desktopSSH';
import type {
  DesktopControlPlaneSyncState,
  DesktopManagedLocalRouteState,
  DesktopProviderCatalogFreshness,
  DesktopProviderRemoteRouteState,
} from './providerEnvironmentState';
import type {
  DesktopEnvironmentWindowState,
  DesktopRuntimeControlCapability,
  DesktopRuntimeHealth,
} from './desktopRuntimeHealth';
import type { RuntimeServiceSnapshot } from './runtimeService';

export const DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:launcher-get-snapshot';
export const DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL = 'redeven-desktop:launcher-perform-action';
export const DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL = 'redeven-desktop:launcher-snapshot-updated';
export const DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL = 'redeven-desktop:launcher-action-progress';

export type DesktopTargetKind = 'managed_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_environment' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'managed_environment' | 'remote_environment' | 'startup';
export type DesktopLauncherSurface = 'connect_environment' | 'environment_settings';
export type DesktopEnvironmentEntryKind = 'managed_environment' | 'provider_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopEnvironmentEntryTag = 'Open' | 'Recent' | 'Saved' | 'Managed' | '';
export type DesktopEnvironmentEntryCategory = 'managed' | 'provider' | 'open_unsaved' | DesktopSavedEnvironmentSource;
export type DesktopManagedEnvironmentRoute = 'local_host' | 'remote_desktop';
export type DesktopManagedLocalRuntimeState = 'not_running' | 'running_desktop' | 'running_external';
export type DesktopManagedLocalCloseBehavior = 'stops_runtime' | 'detaches' | 'not_applicable';
export type DesktopLauncherSessionLifecycle = 'opening' | 'open' | 'closing';
export type DesktopLauncherActionOutcome =
  | 'opened_environment_window'
  | 'focused_environment_window'
  | 'started_environment_runtime'
  | 'stopped_environment_runtime'
  | 'refreshed_environment_runtime'
  | 'refreshed_all_environment_runtimes'
  | 'opened_utility_window'
  | 'focused_utility_window'
  | 'started_control_plane_connect'
  | 'refreshed_control_plane'
  | 'deleted_control_plane'
  | 'saved_environment'
  | 'deleted_environment'
  | 'closed_launcher'
  | 'quit_app';
export type DesktopLauncherActionFailureScope = 'environment' | 'control_plane' | 'dialog' | 'global';
export type DesktopLauncherActionFailureCode =
  | 'session_stale'
  | 'environment_opening'
  | 'environment_missing'
  | 'environment_in_use'
  | 'environment_route_unavailable'
  | 'environment_offline'
  | 'environment_status_stale'
  | 'runtime_not_started'
  | 'runtime_not_ready'
  | 'control_plane_missing'
  | 'control_plane_environment_missing'
  | 'provider_environment_removed'
  | 'control_plane_auth_required'
  | 'provider_sync_in_progress'
  | 'provider_sync_required'
  | 'provider_unreachable'
  | 'provider_invalid_response'
  | 'runtime_start_failed'
  | 'action_invalid';
export type DesktopLauncherActionKind =
  | 'open_managed_environment'
  | 'open_provider_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'start_environment_runtime'
  | 'stop_environment_runtime'
  | 'refresh_environment_runtime'
  | 'refresh_all_environment_runtimes'
  | 'start_control_plane_connect'
  | 'set_managed_environment_pinned'
  | 'set_provider_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'open_environment_settings'
  | 'focus_environment_window'
  | 'refresh_control_plane'
  | 'delete_control_plane'
  | 'upsert_managed_environment'
  | 'upsert_provider_environment_local_runtime'
  | 'upsert_saved_environment'
  | 'upsert_saved_ssh_environment'
  | 'delete_managed_environment'
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
  lifecycle: Extract<DesktopLauncherSessionLifecycle, 'open'>;
}>;

export type DesktopLauncherRuntimeTarget = Readonly<
  Partial<{
    environment_id: string;
    provider_origin: string;
    provider_id: string;
    env_public_id: string;
    external_local_ui_url: string;
    label: string;
    force_runtime_update: boolean;
  }>
  & Partial<DesktopSSHEnvironmentDetails>
>;

export type DesktopEnvironmentEntry = Readonly<{
  id: string;
  kind: DesktopEnvironmentEntryKind;
  label: string;
  local_ui_url: string;
  secondary_text: string;
  managed_environment_kind?: 'local' | 'controlplane';
  managed_local_scope_kind?: 'local' | 'named' | 'controlplane';
  managed_environment_name?: string;
  managed_local_ui_bind?: string;
  managed_local_ui_password_configured?: boolean;
  managed_local_owner?: 'desktop' | 'agent' | 'unknown';
  managed_local_runtime_state?: DesktopManagedLocalRuntimeState;
  managed_local_runtime_url?: string;
  managed_runtime_service?: RuntimeServiceSnapshot;
  managed_local_close_behavior?: DesktopManagedLocalCloseBehavior;
  managed_has_local_hosting?: boolean;
  managed_has_remote_desktop?: boolean;
  managed_preferred_open_route?: 'auto' | DesktopManagedEnvironmentRoute;
  default_open_route?: DesktopManagedEnvironmentRoute;
  open_local_session_key?: string;
  open_local_session_lifecycle?: DesktopLauncherSessionLifecycle;
  open_remote_session_key?: string;
  open_remote_session_lifecycle?: DesktopLauncherSessionLifecycle;
  provider_local_ui_bind?: string;
  provider_local_ui_password_configured?: boolean;
  provider_local_owner?: 'desktop' | 'agent' | 'unknown';
  provider_preferred_open_route?: 'auto' | DesktopManagedEnvironmentRoute;
  provider_default_open_route?: DesktopManagedEnvironmentRoute;
  provider_effective_window_route?: DesktopManagedEnvironmentRoute | '';
  provider_local_runtime_configured?: boolean;
  provider_local_runtime_state?: DesktopManagedLocalRuntimeState;
  provider_local_runtime_url?: string;
  provider_runtime_service?: RuntimeServiceSnapshot;
  provider_local_close_behavior?: DesktopManagedLocalCloseBehavior;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  remote_environment_url?: string;
  provider_status?: string;
  provider_lifecycle_status?: string;
  provider_last_seen_at_unix_ms?: number;
  control_plane_sync_state?: DesktopControlPlaneSyncState;
  local_route_state?: DesktopManagedLocalRouteState;
  remote_route_state?: DesktopProviderRemoteRouteState;
  remote_catalog_freshness?: DesktopProviderCatalogFreshness;
  remote_state_reason?: string;
  ssh_details?: DesktopSSHEnvironmentDetails;
  pinned: boolean;
  control_plane_label?: string;
  tag: DesktopEnvironmentEntryTag;
  category: DesktopEnvironmentEntryCategory;
  window_state: DesktopEnvironmentWindowState;
  is_open: boolean;
  is_opening: boolean;
  runtime_health: DesktopRuntimeHealth;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_capability: DesktopRuntimeControlCapability;
  open_session_key: string;
  open_session_lifecycle?: DesktopLauncherSessionLifecycle;
  open_action_label: 'Open' | 'Opening…' | 'Focus';
  can_edit: boolean;
  can_delete: boolean;
  can_save: boolean;
  last_used_at_ms: number;
}>;

export type DesktopWelcomeSnapshot = Readonly<{
  snapshot_revision?: number;
  surface: DesktopLauncherSurface;
  entry_reason: DesktopWelcomeEntryReason;
  close_action_label: 'Quit' | 'Close Launcher';
  open_windows: readonly DesktopOpenEnvironmentWindow[];
  environments: readonly DesktopEnvironmentEntry[];
  control_planes: readonly DesktopControlPlaneSummary[];
  action_progress: readonly DesktopLauncherActionProgress[];
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
      kind: 'open_provider_environment';
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
  | ({
      kind: 'start_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'stop_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'refresh_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | {
      kind: 'refresh_all_environment_runtimes';
    }
  | {
      kind: 'start_control_plane_connect';
      provider_origin: string;
      display_label?: string;
    }
  | {
      kind: 'set_managed_environment_pinned';
      environment_id: string;
      pinned: boolean;
    }
  | {
      kind: 'set_provider_environment_pinned';
      environment_id: string;
      pinned: boolean;
    }
  | {
      kind: 'set_saved_environment_pinned';
      environment_id: string;
      label: string;
      external_local_ui_url: string;
      pinned: boolean;
    }
  | ({
      kind: 'set_saved_ssh_environment_pinned';
      environment_id: string;
      label: string;
      pinned: boolean;
    }
    & DesktopSSHEnvironmentDetails)
  | {
      kind: 'open_environment_settings';
      environment_id: string;
    }
  | {
      kind: 'focus_environment_window';
      session_key: string;
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
      kind: 'upsert_managed_environment';
      environment_id?: string;
      environment_name?: string;
      label: string;
      local_ui_bind: string;
      local_ui_password: string;
      local_ui_password_mode: 'keep' | 'replace' | 'clear';
    }
  | {
      kind: 'upsert_provider_environment_local_runtime';
      environment_id: string;
      label: string;
      local_ui_bind: string;
      local_ui_password: string;
      local_ui_password_mode: 'keep' | 'replace' | 'clear';
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
      kind: 'delete_managed_environment';
      environment_id: string;
    }
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

export type DesktopLauncherActionSuccess = Readonly<{
  ok: true;
  outcome: DesktopLauncherActionOutcome;
  session_key?: string;
  utility_window_kind?: 'launcher' | 'environment_settings';
}>;

export type DesktopLauncherActionFailure = Readonly<{
  ok: false;
  code: DesktopLauncherActionFailureCode;
  scope: DesktopLauncherActionFailureScope;
  message: string;
  environment_id?: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  should_refresh_snapshot?: boolean;
}>;

export type DesktopLauncherActionResult = DesktopLauncherActionSuccess | DesktopLauncherActionFailure;

export type DesktopLauncherActionProgress = Readonly<{
  action: DesktopLauncherActionKind;
  environment_id?: string;
  environment_label?: string;
  operation_key?: string;
  started_at_unix_ms?: number;
  phase: string;
  title: string;
  detail: string;
}>;

export function isDesktopLauncherActionFailure(
  result: DesktopLauncherActionResult | null | undefined,
): result is DesktopLauncherActionFailure {
  return result?.ok === false;
}

export function isDesktopLauncherActionSuccess(
  result: DesktopLauncherActionResult | null | undefined,
): result is DesktopLauncherActionSuccess {
  return result?.ok === true;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDesktopLauncherRuntimeTarget(
  candidate: Record<string, unknown>,
): DesktopLauncherRuntimeTarget | null {
  const environmentID = compact(candidate.environment_id);
  const providerOriginRaw = compact(candidate.provider_origin);
  const providerID = compact(candidate.provider_id);
  const envPublicID = compact(candidate.env_public_id);
  const externalLocalUIURL = compact(candidate.external_local_ui_url);
  const label = compact(candidate.label);
  const sshDestination = compact(candidate.ssh_destination);
  const sshPortText = compact(candidate.ssh_port);
  const sshAuthMode = compact(candidate.auth_mode);
  const remoteInstallDir = compact(candidate.remote_install_dir);
  const bootstrapStrategy = compact(candidate.bootstrap_strategy);
  const releaseBaseURL = compact(candidate.release_base_url);
  const environmentInstanceID = compact(candidate.environment_instance_id);

  let providerOrigin = '';
  if (providerOriginRaw !== '') {
    try {
      providerOrigin = normalizeControlPlaneOrigin(providerOriginRaw);
    } catch {
      return null;
    }
  }

  const target: DesktopLauncherRuntimeTarget = {
    ...(environmentID !== '' ? { environment_id: environmentID } : {}),
    ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
    ...(providerID !== '' ? { provider_id: providerID } : {}),
    ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
    ...(externalLocalUIURL !== '' ? { external_local_ui_url: externalLocalUIURL } : {}),
    ...(label !== '' ? { label } : {}),
    ...(sshDestination !== '' ? { ssh_destination: sshDestination } : {}),
    ...(candidate.ssh_port != null || sshPortText !== ''
      ? {
          ssh_port: sshPortText === ''
            ? null
            : Number.parseInt(sshPortText, 10),
        }
      : {}),
    ...(sshAuthMode !== '' ? { auth_mode: sshAuthMode as DesktopSSHEnvironmentDetails['auth_mode'] } : {}),
    ...(remoteInstallDir !== '' ? { remote_install_dir: remoteInstallDir } : {}),
    ...(bootstrapStrategy !== '' ? { bootstrap_strategy: bootstrapStrategy as DesktopSSHEnvironmentDetails['bootstrap_strategy'] } : {}),
    ...(releaseBaseURL !== '' ? { release_base_url: releaseBaseURL } : {}),
    ...(environmentInstanceID !== '' ? { environment_instance_id: environmentInstanceID } : {}),
    ...(candidate.force_runtime_update === true ? { force_runtime_update: true } : {}),
  };

  if (
    !target.environment_id
    && !target.provider_origin
    && !target.external_local_ui_url
    && !target.ssh_destination
  ) {
    return null;
  }
  return target;
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
    case 'open_provider_environment':
    case 'open_environment_settings': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        ...((kind === 'open_managed_environment' || kind === 'open_provider_environment')
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
    case 'start_environment_runtime':
    case 'stop_environment_runtime':
    case 'refresh_environment_runtime': {
      const target = normalizeDesktopLauncherRuntimeTarget(candidate as Record<string, unknown>);
      if (!target) {
        return null;
      }
      return {
        kind,
        ...target,
      } as DesktopLauncherActionRequest;
    }
    case 'refresh_all_environment_runtimes':
      return { kind };
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
        auth_mode: compact((candidate as { auth_mode?: unknown }).auth_mode) as DesktopSSHEnvironmentDetails['auth_mode'],
        remote_install_dir: compact((candidate as { remote_install_dir?: unknown }).remote_install_dir),
        bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
        release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
        environment_instance_id: compact((candidate as { environment_instance_id?: unknown }).environment_instance_id),
      };
      }
    case 'start_control_plane_connect':
      {
        const providerOrigin = compact((candidate as { provider_origin?: unknown }).provider_origin);
        if (providerOrigin === '') {
          return null;
        }
        try {
          return {
            kind,
            provider_origin: normalizeControlPlaneOrigin(providerOrigin),
            display_label: compact((candidate as { display_label?: unknown }).display_label) || undefined,
          };
        } catch {
          return null;
        }
      }
    case 'set_managed_environment_pinned': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        pinned: (candidate as { pinned?: unknown }).pinned === true,
      };
    }
    case 'set_provider_environment_pinned': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        pinned: (candidate as { pinned?: unknown }).pinned === true,
      };
    }
    case 'set_saved_environment_pinned': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        label: compact((candidate as { label?: unknown }).label),
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
        pinned: (candidate as { pinned?: unknown }).pinned === true,
      };
    }
    case 'set_saved_ssh_environment_pinned':
      {
        const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
        if (environmentID === '') {
          return null;
        }
        const sshPortText = compact((candidate as { ssh_port?: unknown }).ssh_port);
        return {
          kind,
          environment_id: environmentID,
          label: compact((candidate as { label?: unknown }).label),
          pinned: (candidate as { pinned?: unknown }).pinned === true,
          ssh_destination: compact((candidate as { ssh_destination?: unknown }).ssh_destination),
          ssh_port: (candidate as { ssh_port?: unknown }).ssh_port == null || sshPortText === ''
            ? null
            : Number.parseInt(sshPortText, 10),
          auth_mode: compact((candidate as { auth_mode?: unknown }).auth_mode) as DesktopSSHEnvironmentDetails['auth_mode'],
          remote_install_dir: compact((candidate as { remote_install_dir?: unknown }).remote_install_dir),
          bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
          release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
          environment_instance_id: compact((candidate as { environment_instance_id?: unknown }).environment_instance_id),
        };
      }
    case 'upsert_managed_environment': {
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        environment_name: compact((candidate as { environment_name?: unknown }).environment_name) || undefined,
        label: compact((candidate as { label?: unknown }).label),
        local_ui_bind: compact((candidate as { local_ui_bind?: unknown }).local_ui_bind),
        local_ui_password: String((candidate as { local_ui_password?: unknown }).local_ui_password ?? ''),
        local_ui_password_mode: compact(
          (candidate as { local_ui_password_mode?: unknown }).local_ui_password_mode,
        ) as 'keep' | 'replace' | 'clear',
      };
    }
    case 'upsert_provider_environment_local_runtime': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        label: compact((candidate as { label?: unknown }).label),
        local_ui_bind: compact((candidate as { local_ui_bind?: unknown }).local_ui_bind),
        local_ui_password: String((candidate as { local_ui_password?: unknown }).local_ui_password ?? ''),
        local_ui_password_mode: compact(
          (candidate as { local_ui_password_mode?: unknown }).local_ui_password_mode,
        ) as 'keep' | 'replace' | 'clear',
      };
    }
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
    case 'refresh_control_plane':
    case 'delete_control_plane': {
      const providerOrigin = compact((candidate as { provider_origin?: unknown }).provider_origin);
      const providerID = compact((candidate as { provider_id?: unknown }).provider_id);
      if (providerOrigin === '' || providerID === '') {
        return null;
      }
      return {
        kind,
        provider_origin: providerOrigin,
        provider_id: providerID,
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
        auth_mode: compact((candidate as { auth_mode?: unknown }).auth_mode) as DesktopSSHEnvironmentDetails['auth_mode'],
        remote_install_dir: compact((candidate as { remote_install_dir?: unknown }).remote_install_dir),
        bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
        release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
        environment_instance_id: compact((candidate as { environment_instance_id?: unknown }).environment_instance_id),
      };
      }
    case 'delete_managed_environment':
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
