import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';
import type { DesktopControlPlaneSummary } from './controlPlaneProvider';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import { normalizeDesktopSSHConnectTimeoutSeconds, type DesktopSSHEnvironmentDetails } from './desktopSSH';
import type {
  DesktopControlPlaneSyncState,
  DesktopLocalRouteState,
  DesktopProviderCatalogFreshness,
  DesktopProviderRemoteRouteState,
} from './providerEnvironmentState';
import type {
  DesktopEnvironmentWindowState,
  DesktopRuntimeMaintenanceRequirement,
  DesktopRuntimeControlCapability,
  DesktopRuntimeHealth,
} from './desktopRuntimeHealth';
import type { DesktopLocalRuntimeOpenPlan } from './localRuntimeSupervisor';
import type { RuntimeServiceSnapshot } from './runtimeService';
import {
  normalizeDesktopRuntimeHostAccess,
  normalizeDesktopRuntimePlacement,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
  type DesktopRuntimeTargetID,
} from './desktopRuntimePlacement';
import type {
  DesktopProviderEnvironmentCandidate,
  DesktopProviderRuntimeLinkTarget,
  DesktopProviderRuntimeLinkTargetID,
} from './providerRuntimeLinkTarget';
import { normalizeDesktopProviderRuntimeLinkRequestTarget } from './environmentManagementPrinciples';

export const DESKTOP_LAUNCHER_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:launcher-get-snapshot';
export const DESKTOP_LAUNCHER_PERFORM_ACTION_CHANNEL = 'redeven-desktop:launcher-perform-action';
export const DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL = 'redeven-desktop:launcher-snapshot-updated';
export const DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL = 'redeven-desktop:launcher-action-progress';

export type DesktopTargetKind = 'local_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_environment' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'local_environment' | 'remote_environment' | 'startup';
export type DesktopLauncherSurface = 'connect_environment' | 'environment_settings';
export type DesktopEnvironmentEntryKind = 'local_environment' | 'provider_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopEnvironmentEntryTag = 'Open' | 'Saved' | 'Local' | 'Provider' | '';
export type DesktopEnvironmentEntryCategory = 'local' | 'provider' | 'saved';
export type DesktopLocalEnvironmentStateRoute = 'local_host' | 'remote_desktop';
export type DesktopLocalRuntimeState = 'not_running' | 'running_desktop' | 'running_external';
export type DesktopLocalCloseBehavior = 'stops_runtime' | 'detaches' | 'not_applicable';
export type DesktopLauncherSessionLifecycle = 'opening' | 'open' | 'closing';
export type DesktopLauncherOperationStatus =
  | 'running'
  | 'canceling'
  | 'canceled'
  | 'cleanup_running'
  | 'cleanup_failed'
  | 'failed'
  | 'succeeded';
export type DesktopLauncherOperationSubjectKind =
  | 'local_environment'
  | 'external_local_ui'
  | 'ssh_environment'
  | 'control_plane';
export type DesktopLauncherActionOutcome =
  | 'opened_environment_window'
  | 'focused_environment_window'
  | 'started_environment_runtime'
  | 'connected_provider_runtime'
  | 'disconnected_provider_runtime'
  | 'stopped_environment_runtime'
  | 'canceled_launcher_operation'
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
  | 'provider_link_failed'
  | 'runtime_start_failed'
  | 'operation_missing'
  | 'operation_not_cancelable'
  | 'action_invalid';
export type DesktopLauncherActionKind =
  | 'open_local_environment'
  | 'open_provider_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'start_environment_runtime'
  | 'connect_provider_runtime'
  | 'disconnect_provider_runtime'
  | 'stop_environment_runtime'
  | 'refresh_environment_runtime'
  | 'refresh_all_environment_runtimes'
  | 'start_control_plane_connect'
  | 'set_local_environment_pinned'
  | 'set_provider_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'open_environment_settings'
  | 'focus_environment_window'
  | 'refresh_control_plane'
  | 'delete_control_plane'
  | 'save_local_environment_settings'
  | 'upsert_saved_environment'
  | 'upsert_saved_ssh_environment'
  | 'delete_saved_environment'
  | 'delete_saved_ssh_environment'
  | 'cancel_launcher_operation'
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
    runtime_target_id: DesktopRuntimeTargetID;
    placement_target_id: DesktopRuntimeTargetID;
    host_access: DesktopRuntimeHostAccess;
    placement: DesktopRuntimePlacement;
    environment_id: string;
    provider_origin: string;
    provider_id: string;
    env_public_id: string;
    external_local_ui_url: string;
    label: string;
    force_runtime_update: boolean;
    allow_active_work_replacement: boolean;
  }>
  & Partial<DesktopSSHEnvironmentDetails>
>;

export type DesktopEnvironmentEntry = Readonly<{
  id: string;
  kind: DesktopEnvironmentEntryKind;
  label: string;
  local_ui_url: string;
  secondary_text: string;
  local_environment_kind?: 'local' | 'controlplane';
  local_environment_ui_bind?: string;
  local_environment_ui_password_configured?: boolean;
  local_environment_owner?: 'desktop' | 'agent' | 'unknown';
  local_environment_runtime_state?: DesktopLocalRuntimeState;
  local_environment_runtime_url?: string;
  local_environment_runtime_plan?: DesktopLocalRuntimeOpenPlan;
  local_environment_runtime_service?: RuntimeServiceSnapshot;
  local_environment_close_behavior?: DesktopLocalCloseBehavior;
  local_environment_has_local_hosting?: boolean;
  local_environment_has_remote_desktop?: boolean;
  local_environment_preferred_open_route?: 'auto' | DesktopLocalEnvironmentStateRoute;
  default_open_route?: DesktopLocalEnvironmentStateRoute;
  open_local_session_key?: string;
  open_local_session_lifecycle?: DesktopLauncherSessionLifecycle;
  open_remote_session_key?: string;
  open_remote_session_lifecycle?: DesktopLauncherSessionLifecycle;
  provider_runtime_link_target?: DesktopProviderRuntimeLinkTarget;
  provider_environment_candidates?: readonly DesktopProviderEnvironmentCandidate[];
  managed_runtime_target_id?: DesktopRuntimeTargetID;
  managed_runtime_placement_target_id?: DesktopRuntimeTargetID;
  managed_runtime_host_access?: DesktopRuntimeHostAccess;
  managed_runtime_placement?: DesktopRuntimePlacement;
  provider_linked_runtime_summary?: Readonly<{
    runtime_target_id: DesktopProviderRuntimeLinkTargetID;
    runtime_kind: DesktopProviderRuntimeLinkTarget['kind'];
    label: string;
    provider_link_remote_enabled?: boolean;
    runtime_remote_enabled?: boolean;
  }>;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  remote_environment_url?: string;
  provider_status?: string;
  provider_lifecycle_status?: string;
  provider_last_seen_at_unix_ms?: number;
  control_plane_sync_state?: DesktopControlPlaneSyncState;
  local_route_state?: DesktopLocalRouteState;
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
  runtime_maintenance?: DesktopRuntimeMaintenanceRequirement;
  runtime_control_capability: DesktopRuntimeControlCapability;
  open_session_key: string;
  open_session_lifecycle?: DesktopLauncherSessionLifecycle;
  open_action_label: 'Open' | 'Opening…' | 'Focus';
  can_edit: boolean;
  can_delete: boolean;
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
  operations: readonly DesktopLauncherOperationSnapshot[];
  suggested_remote_url: string;
  issue: DesktopWelcomeIssue | null;
  settings_surface: DesktopSettingsSurfaceSnapshot;
}>;

export type DesktopLauncherOperationSnapshot = Readonly<{
  operation_key: string;
  action: DesktopLauncherActionKind;
  subject_kind: DesktopLauncherOperationSubjectKind;
  subject_id: string;
  subject_generation: number;
  environment_id?: string;
  environment_label?: string;
  provider_origin?: string;
  provider_id?: string;
  started_at_unix_ms: number;
  updated_at_unix_ms: number;
  status: DesktopLauncherOperationStatus;
  phase: string;
  title: string;
  detail: string;
  cancelable: boolean;
  interrupt_label?: string;
  interrupt_detail?: string;
  interrupt_kind?: 'stop_opening' | 'cleanup_deleted_subject' | 'generic';
  deleted_subject: boolean;
  error_message?: string;
}>;

export type DesktopLauncherActionRequest = Readonly<
  | {
      kind: 'open_local_environment';
      environment_id: string;
      route?: 'auto' | DesktopLocalEnvironmentStateRoute;
    }
  | {
      kind: 'open_provider_environment';
      environment_id: string;
      route?: 'auto' | DesktopLocalEnvironmentStateRoute;
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
  | {
      kind: 'connect_provider_runtime';
      provider_environment_id: string;
      runtime_target_id: DesktopProviderRuntimeLinkTargetID;
  }
  | {
      kind: 'disconnect_provider_runtime';
      provider_environment_id: string;
      runtime_target_id: DesktopProviderRuntimeLinkTargetID;
  }
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
      kind: 'set_local_environment_pinned';
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
      kind: 'save_local_environment_settings';
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
      kind: 'delete_saved_environment';
      environment_id: string;
    }
  | {
      kind: 'delete_saved_ssh_environment';
      environment_id: string;
    }
  | {
      kind: 'cancel_launcher_operation';
      operation_key: string;
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
  subject_kind?: DesktopLauncherOperationSubjectKind;
  subject_id?: string;
  started_at_unix_ms?: number;
  updated_at_unix_ms?: number;
  status?: DesktopLauncherOperationStatus;
  phase: string;
  title: string;
  detail: string;
  cancelable?: boolean;
  interrupt_label?: string;
  interrupt_detail?: string;
  interrupt_kind?: 'stop_opening' | 'cleanup_deleted_subject' | 'generic';
  deleted_subject?: boolean;
  error_message?: string;
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
  const runtimeTargetID = compact(candidate.runtime_target_id);
  const placementTargetID = compact(candidate.placement_target_id);
  let hostAccess: DesktopRuntimeHostAccess | undefined;
  let placement: DesktopRuntimePlacement | undefined;
  if (candidate.host_access != null) {
    try {
      hostAccess = normalizeDesktopRuntimeHostAccess(candidate.host_access);
    } catch {
      return null;
    }
  }
  if (candidate.placement != null) {
    try {
      placement = normalizeDesktopRuntimePlacement(candidate.placement);
    } catch {
      return null;
    }
  }
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

  let providerOrigin = '';
  if (providerOriginRaw !== '') {
    try {
      providerOrigin = normalizeControlPlaneOrigin(providerOriginRaw);
    } catch {
      return null;
    }
  }

  const target: DesktopLauncherRuntimeTarget = {
    ...(runtimeTargetID.startsWith('local:') || runtimeTargetID.startsWith('ssh:')
      ? { runtime_target_id: runtimeTargetID as DesktopRuntimeTargetID }
      : {}),
    ...(placementTargetID.startsWith('local:') || placementTargetID.startsWith('ssh:')
      ? { placement_target_id: placementTargetID as DesktopRuntimeTargetID }
      : {}),
    ...(hostAccess ? { host_access: hostAccess } : {}),
    ...(placement ? { placement } : {}),
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
    ...(candidate.connect_timeout_seconds != null ? { connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds(candidate.connect_timeout_seconds) } : {}),
    ...(candidate.force_runtime_update === true ? { force_runtime_update: true } : {}),
    ...(candidate.allow_active_work_replacement === true ? { allow_active_work_replacement: true } : {}),
  };

  if (
    !target.environment_id
    && !target.runtime_target_id
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
    case 'open_local_environment':
    case 'open_provider_environment':
    case 'open_environment_settings': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        ...((kind === 'open_local_environment' || kind === 'open_provider_environment')
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
    case 'connect_provider_runtime':
    case 'disconnect_provider_runtime': {
      // IMPORTANT: Provider-link IPC must preserve the exact runtime target the
      // user selected from a Local/SSH card. Do not infer or fallback to another
      // runtime from the provider environment alone.
      const target = normalizeDesktopProviderRuntimeLinkRequestTarget({
        provider_environment_id: (candidate as { provider_environment_id?: unknown }).provider_environment_id,
        runtime_target_id: (candidate as { runtime_target_id?: unknown }).runtime_target_id,
      });
      if (!target) {
        return null;
      }
      return {
        kind,
        ...target,
      } as DesktopLauncherActionRequest;
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
        connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
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
    case 'set_local_environment_pinned': {
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
          connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
        };
      }
    case 'save_local_environment_settings': {
      return {
        kind,
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
        connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
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
    case 'cancel_launcher_operation': {
      const operationKey = compact((candidate as { operation_key?: unknown }).operation_key);
      if (operationKey === '') {
        return null;
      }
      return {
        kind,
        operation_key: operationKey,
      };
    }
    default:
      return null;
  }
}
