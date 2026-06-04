import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';
import type { DesktopControlPlaneSummary } from './controlPlaneProvider';
import { normalizeControlPlaneOrigin } from './controlPlaneProvider';
import {
  normalizeDesktopSSHAuthMode,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHConnectTimeoutSeconds,
  normalizeDesktopSSHDestination,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRuntimeRoot,
  type DesktopSSHEnvironmentDetails,
} from './desktopSSH';
import type {
  DesktopControlPlaneSyncState,
  DesktopLocalRouteState,
  DesktopProviderCatalogFreshness,
  DesktopProviderRemoteRouteState,
} from './providerEnvironmentState';
import type {
  DesktopEnvironmentWindowState,
  DesktopRuntimeMaintenanceRequirement,
  DesktopRuntimeHealth,
} from './desktopRuntimeHealth';
import type { DesktopRuntimeOperationPlans } from './desktopRuntimeOperations';
import type { DesktopOpenConnectionProgress } from './desktopOpenConnectionProgress';
import type { DesktopRuntimeLifecycleProgress } from './desktopRuntimeLifecycleProgress';
import type { DesktopOperationFailurePresentation } from './desktopOperationFailure';
import type { DesktopLocalRuntimeOpenPlan } from './localRuntimeSupervisor';
import type { RuntimeServiceProviderConnectionState, RuntimeServiceSnapshot } from './runtimeService';
import type { DesktopTranslationKey } from './i18n/desktopI18n';
import type {
  DesktopEnvironmentSource,
  DesktopGatewayConnectionKind,
  DesktopGatewayEnvironment,
  DesktopGatewayEnvironmentCapability,
  DesktopGatewayEnvironmentState,
  DesktopGatewayServiceState,
  DesktopGatewaySource,
  DesktopGatewayStatus,
  DesktopGatewayTrustState,
} from './desktopGateway';
import {
  normalizeDesktopRuntimeHostAccess,
  normalizeDesktopRuntimePlacement,
  normalizeDesktopContainerEngine,
  type DesktopContainerEngine,
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

export type DesktopTargetKind = 'local_environment' | 'external_local_ui' | 'ssh_environment' | 'gateway_environment';
export type DesktopWelcomeEntryReason = 'app_launch' | 'switch_environment' | 'connect_failed' | 'blocked';
export type DesktopWelcomeIssueScope = 'local_environment' | 'remote_environment' | 'startup';
export type DesktopLauncherSurface = 'connect_environment' | 'environment_settings' | 'flower_host';
export type DesktopEnvironmentEntryKind = 'local_environment' | 'provider_environment' | 'gateway_environment' | 'external_local_ui' | 'ssh_environment';
export type DesktopEnvironmentEntryTag = 'Open' | 'Saved' | 'Local' | 'Provider' | 'Gateway' | 'Resolve' | '';
export type DesktopEnvironmentEntryCategory = 'local' | 'provider' | 'gateway' | 'saved';
export type DesktopEnvironmentOpenAction = 'open' | 'opening' | 'focus';
export type DesktopLauncherCloseAction = 'quit' | 'close_launcher';
export type DesktopLocalEnvironmentStateRoute = 'local_host' | 'remote_desktop';
export type DesktopLocalRuntimeState = 'not_running' | 'running_desktop' | 'running_external';
export type DesktopLocalCloseBehavior = 'detaches' | 'not_applicable';
export type DesktopLauncherSessionLifecycle = 'opening' | 'open' | 'closing';
export type DesktopLauncherOperationStatus =
  | 'running'
  | 'canceling'
  | 'canceled'
  | 'cleanup_running'
  | 'cleanup_failed'
  | 'failed'
  | 'succeeded';
export type DesktopStepProgressStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type DesktopStepProgressStep = Readonly<{
  id: string;
  backend_event?: string;
  label: string;
  label_key?: DesktopTranslationKey;
  status: DesktopStepProgressStepStatus;
  detail?: string;
  detail_key?: DesktopTranslationKey;
}>;
export type DesktopStepProgress = Readonly<{
  active_step_id: string;
  steps: readonly DesktopStepProgressStep[];
}>;
export type DesktopLauncherOperationSubjectKind =
  | 'local_environment'
  | 'provider_environment'
  | 'external_local_ui'
  | 'ssh_environment'
  | 'runtime_target'
  | 'gateway'
  | 'control_plane';
export type DesktopLauncherActionOutcome =
  | 'opened_environment_window'
  | 'focused_environment_window'
  | 'started_environment_runtime'
  | 'restarted_environment_runtime'
  | 'updated_environment_runtime'
  | 'opened_desktop_update_handoff'
  | 'connected_provider_runtime'
  | 'disconnected_provider_runtime'
  | 'stopped_environment_runtime'
  | 'canceled_launcher_operation'
  | 'dismissed_launcher_operation'
  | 'refreshed_environment_runtime'
  | 'refreshed_all_environment_runtimes'
  | 'opened_utility_window'
  | 'focused_utility_window'
  | 'opened_flower_host'
  | 'opened_environment_center'
  | 'started_control_plane_connect'
  | 'refreshed_control_plane'
  | 'deleted_control_plane'
  | 'saved_gateway'
  | 'enabled_gateway'
  | 'disabled_gateway'
  | 'gateway_sync_in_progress'
  | 'synced_gateway'
  | 'paired_gateway'
  | 'started_gateway'
  | 'stopped_gateway'
  | 'restarted_gateway'
  | 'updated_gateway'
  | 'refreshed_gateway_catalog'
  | 'refreshed_gateway_status'
  | 'deleted_gateway'
  | 'saved_gateway_environment'
  | 'deleted_gateway_environment'
  | 'started_gateway_environment_runtime'
  | 'stopped_gateway_environment_runtime'
  | 'restarted_gateway_environment_runtime'
  | 'updated_gateway_environment_runtime'
  | 'saved_environment'
  | 'deleted_environment'
  | 'closed_launcher'
  | 'quit_app';
export type DesktopLauncherActionFailureScope = 'environment' | 'control_plane' | 'gateway' | 'dialog' | 'global';
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
  | 'gateway_start_required'
  | 'gateway_not_manageable'
  | 'gateway_service_unreachable'
  | 'gateway_container_unavailable'
  | 'gateway_bridge_unavailable'
  | 'gateway_service_start_failed'
  | 'gateway_service_stop_failed'
  | 'gateway_service_restart_failed'
  | 'gateway_service_update_failed'
  | 'gateway_catalog_failed'
  | 'confirmation_required'
  | 'operation_missing'
  | 'operation_not_cancelable'
  | 'action_invalid';
export type DesktopLauncherActionKind =
  | 'open_local_environment'
  | 'open_provider_environment'
  | 'open_gateway_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'prepare_environment_open'
  | 'start_environment_runtime'
  | 'restart_environment_runtime'
  | 'update_environment_runtime'
  | 'manage_desktop_update'
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
  | 'set_saved_runtime_target_pinned'
  | 'open_environment_settings'
  | 'open_flower_host'
  | 'open_environment_center'
  | 'focus_environment_window'
  | 'refresh_control_plane'
  | 'delete_control_plane'
  | 'upsert_gateway'
  | 'set_gateway_enabled'
  | 'sync_gateway'
  | 'pair_gateway'
  | 'start_gateway'
  | 'stop_gateway'
  | 'restart_gateway'
  | 'update_gateway'
  | 'refresh_gateway_catalog'
  | 'refresh_gateway_status'
  | 'delete_gateway'
  | 'upsert_gateway_environment_profile'
  | 'delete_gateway_environment_profile'
  | 'run_gateway_environment_lifecycle'
  | 'save_local_environment_settings'
  | 'upsert_saved_environment'
  | 'upsert_saved_ssh_environment'
  | 'upsert_saved_runtime_target'
  | 'delete_saved_environment'
  | 'delete_saved_ssh_environment'
  | 'delete_saved_runtime_target'
  | 'cancel_launcher_operation'
  | 'dismiss_launcher_operation'
  | 'close_launcher_or_quit';

export type DesktopWelcomeIssue = Readonly<{
  scope: DesktopWelcomeIssueScope;
  code: string;
  title: string;
  title_key?: DesktopTranslationKey;
  message: string;
  message_key?: DesktopTranslationKey;
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
    auto_runtime_probe_enabled: boolean;
    ssh_password: string;
    ssh_password_mode: 'keep' | 'replace' | 'clear';
  }>
  & Partial<DesktopSSHEnvironmentDetails>
>;

export type DesktopGatewayStartPolicy = 'require_ready' | 'start_if_needed';

export type DesktopGatewayStartRequiredRetryAction = Readonly<
  | {
      kind: 'sync_gateway';
      gateway_id: string;
      start_policy: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
  | {
      kind: 'pair_gateway';
      gateway_id: string;
      start_policy: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
  | {
      kind: 'open_gateway_environment';
      environment_id: string;
      gateway_id: string;
      gateway_env_id: string;
      label: string;
      start_policy: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
>;
export type DesktopGatewayResolveFocus =
  | 'url_endpoint'
  | 'ssh_host'
  | 'ssh_auth'
  | 'container'
  | 'identity_trust';

export type DesktopGatewayStartRequiredPayload = Readonly<{
  gateway_id: string;
  gateway_label: string;
  reason: 'sync_gateway' | 'pair_gateway' | 'open_gateway_environment';
  service_state?: DesktopGatewayServiceState;
  retry_action: DesktopGatewayStartRequiredRetryAction;
}>;

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
  managed_runtime_open_connection_required?: boolean;
  provider_linked_runtime_summary?: Readonly<{
    runtime_target_id: DesktopProviderRuntimeLinkTargetID;
    runtime_kind: DesktopProviderRuntimeLinkTarget['kind'];
    label: string;
    provider_connection_state: RuntimeServiceProviderConnectionState;
  }>;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  provider_source_id?: string;
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
  ssh_password_configured?: boolean;
  gateway_id?: string;
  gateway_label?: string;
  gateway_env_id?: string;
  gateway_status?: DesktopGatewayStatus;
  gateway_connection_kind?: DesktopGatewayConnectionKind;
  gateway_trust_state?: DesktopGatewayTrustState;
  gateway_status_message?: string;
  gateway_endpoint_label?: string;
  gateway_environment_state?: DesktopGatewayEnvironmentState;
  gateway_environment_kind?: DesktopGatewayEnvironment['env_kind'];
  gateway_environment_capabilities?: readonly DesktopGatewayEnvironmentCapability[];
  gateway_environment_access_capabilities?: readonly DesktopGatewayEnvironmentCapability[];
  gateway_environment_control_capabilities?: readonly DesktopGatewayEnvironmentCapability[];
  gateway_environment_profile?: DesktopGatewayEnvironment['profile'];
  gateway_environment_profile_access_route?: DesktopGatewayEnvironment['profile_access_route'];
  gateway_environment_origin?: DesktopGatewayEnvironment['origin'];
  environment_source?: DesktopEnvironmentSource;
  pinned: boolean;
  control_plane_label?: string;
  tag: DesktopEnvironmentEntryTag;
  category: DesktopEnvironmentEntryCategory;
  window_state: DesktopEnvironmentWindowState;
  is_open: boolean;
  is_opening: boolean;
  runtime_health: DesktopRuntimeHealth;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_started_at_unix_ms?: number;
  runtime_maintenance?: DesktopRuntimeMaintenanceRequirement;
  runtime_operations: DesktopRuntimeOperationPlans;
  auto_runtime_probe_enabled?: boolean;
  auto_runtime_probe_configurable?: boolean;
  open_session_key: string;
  open_session_lifecycle?: DesktopLauncherSessionLifecycle;
  open_action: DesktopEnvironmentOpenAction;
  can_edit: boolean;
  can_delete: boolean;
  created_at_ms: number;
  last_used_at_ms: number;
}>;

export type DesktopWelcomeSnapshot = Readonly<{
  snapshot_revision?: number;
  snapshot_generation?: number;
  surface: DesktopLauncherSurface;
  entry_reason: DesktopWelcomeEntryReason;
  close_action: DesktopLauncherCloseAction;
  open_windows: readonly DesktopOpenEnvironmentWindow[];
  environments: readonly DesktopEnvironmentEntry[];
  gateway_sources: readonly DesktopGatewaySource[];
  control_planes: readonly DesktopControlPlaneSummary[];
  action_progress: readonly DesktopLauncherActionProgress[];
  operations: readonly DesktopLauncherOperationSnapshot[];
  suggested_remote_url: string;
  issue: DesktopWelcomeIssue | null;
  settings_surface: DesktopSettingsSurfaceSnapshot;
}>;

export function desktopWelcomeSnapshotIsAtLeastGeneration(
  snapshot: Pick<DesktopWelcomeSnapshot, 'snapshot_generation'>,
  currentGeneration: number,
): boolean {
  return (snapshot.snapshot_generation ?? 0) >= currentGeneration;
}

export function desktopWelcomeSnapshotGeneration(
  snapshot: Pick<DesktopWelcomeSnapshot, 'snapshot_generation'>,
): number {
  const generation = Number(snapshot.snapshot_generation);
  return Number.isFinite(generation) && generation > 0 ? generation : 0;
}

export function desktopWelcomeSnapshotRevision(
  snapshot: Pick<DesktopWelcomeSnapshot, 'snapshot_revision'>,
): number {
  const revision = Number(snapshot.snapshot_revision);
  return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function normalizeGatewayProfileSSHSecret(value: unknown): Extract<DesktopLauncherActionRequest, { kind: 'upsert_gateway_environment_profile' }>['ssh_secret'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const mode = compact(candidate.mode);
  if (mode !== 'keep' && mode !== 'replace' && mode !== 'clear') {
    return undefined;
  }
  return {
    mode,
    ...(compact(candidate.password) ? { password: compact(candidate.password) } : {}),
  };
}

export function selectLatestDesktopWelcomeSnapshot<T extends Pick<
  DesktopWelcomeSnapshot,
  'snapshot_generation' | 'snapshot_revision'
>>(
  current: T,
  next: T,
): T {
  const currentGeneration = desktopWelcomeSnapshotGeneration(current);
  const nextGeneration = desktopWelcomeSnapshotGeneration(next);
  if (currentGeneration > 0 || nextGeneration > 0) {
    if (nextGeneration === 0 && currentGeneration > 0) {
      return current;
    }
    if (nextGeneration !== currentGeneration) {
      return nextGeneration > currentGeneration ? next : current;
    }
  }

  const currentRevision = desktopWelcomeSnapshotRevision(current);
  const nextRevision = desktopWelcomeSnapshotRevision(next);
  if (currentRevision > 0 || nextRevision > 0) {
    if (nextRevision === 0 && currentRevision > 0) {
      return current;
    }
    if (nextRevision <= currentRevision) {
      return current;
    }
  }
  return next;
}

export type DesktopLauncherOperationSnapshot = Readonly<{
  operation_key: string;
  action: DesktopLauncherActionKind;
  subject_kind: DesktopLauncherOperationSubjectKind;
  subject_id: string;
  subject_generation: number;
  environment_id?: string;
  environment_label?: string;
  gateway_id?: string;
  gateway_environment_id?: string;
  provider_origin?: string;
  provider_id?: string;
  started_at_unix_ms: number;
  updated_at_unix_ms: number;
  status: DesktopLauncherOperationStatus;
  phase: string;
  title: string;
  title_key?: DesktopTranslationKey;
  detail: string;
  detail_key?: DesktopTranslationKey;
  lifecycle_progress?: DesktopRuntimeLifecycleProgress;
  open_progress?: DesktopOpenConnectionProgress;
  step_progress?: DesktopStepProgress;
  cancelable: boolean;
  interrupt_label?: string;
  interrupt_label_key?: DesktopTranslationKey;
  interrupt_detail?: string;
  interrupt_detail_key?: DesktopTranslationKey;
  interrupt_kind?: 'stop_opening' | 'cleanup_deleted_subject' | 'generic';
  deleted_subject: boolean;
  next_actions?: readonly DesktopLauncherOperationNextAction[];
  failure?: DesktopOperationFailurePresentation;
}>;

export type DesktopLauncherOperationNextAction = Readonly<
  | {
      kind: 'retry';
      operation_key: string;
      label: string;
      label_key?: DesktopTranslationKey;
      retry_action?: DesktopLauncherActionRequest;
    }
  | {
      kind: 'refresh_status';
      environment_id?: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'refresh_gateway_status';
      gateway_id: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'refresh_gateway_catalog';
      gateway_id: string;
      start_policy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'copy_diagnostics';
      operation_key: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'dismiss';
      operation_key: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'update_runtime';
      environment_id: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'update_gateway';
      gateway_id: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'resolve_gateway';
      gateway_id: string;
      resolve_focus?: DesktopGatewayResolveFocus;
      label: string;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'open_gateway_environment';
      gateway_id: string;
      environment_id: string;
      gateway_env_id: string;
      label: string;
      start_policy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
      label_key?: DesktopTranslationKey;
    }
  | {
      kind: 'manage_desktop_update';
      environment_id: string;
      label: string;
      label_key?: DesktopTranslationKey;
    }
>;

export type DesktopLauncherActionRequest = Readonly<
  | {
      kind: 'open_local_environment';
      environment_id: string;
      route?: 'auto' | DesktopLocalEnvironmentStateRoute;
    } & DesktopLauncherRuntimeTarget
  | {
      kind: 'open_provider_environment';
      environment_id: string;
      route?: 'auto' | DesktopLocalEnvironmentStateRoute;
    }
  | {
      kind: 'open_gateway_environment';
      environment_id: string;
      gateway_id: string;
      gateway_env_id: string;
      label: string;
      start_policy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
  | {
      kind: 'open_remote_environment';
      external_local_ui_url: string;
      environment_id?: string;
      label?: string;
    }
  | ({
      kind: 'prepare_environment_open';
    } & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'open_ssh_environment';
      environment_id?: string;
      label?: string;
    } & DesktopSSHEnvironmentDetails & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'start_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'restart_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | ({
      kind: 'update_environment_runtime';
    } & DesktopLauncherRuntimeTarget)
  | {
      kind: 'manage_desktop_update';
      environment_id: string;
      label?: string;
    }
  | {
      kind: 'connect_provider_runtime';
      provider_environment_id: string;
      runtime_target_id: DesktopProviderRuntimeLinkTargetID;
  }
  | {
      kind: 'disconnect_provider_runtime';
      provider_environment_id?: string;
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
  | ({
      kind: 'set_saved_runtime_target_pinned';
      environment_id: string;
      label: string;
      pinned: boolean;
    } & Required<Pick<DesktopLauncherRuntimeTarget, 'host_access' | 'placement'>>)
  | {
      kind: 'open_environment_settings';
      environment_id: string;
    }
  | {
      kind: 'open_flower_host';
    }
  | {
      kind: 'open_environment_center';
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
      kind: 'upsert_gateway';
      gateway_id?: string;
      display_name: string;
	      connection_kind: 'url';
	      gateway_url: string;
	      pairing_code?: string;
	      allow_loopback_http: boolean;
	    }
  | {
      kind: 'upsert_gateway';
      gateway_id?: string;
      display_name: string;
      connection_kind: 'ssh_host';
      ssh_destination: string;
      ssh_port: number | null;
      auth_mode: DesktopSSHEnvironmentDetails['auth_mode'];
      ssh_password: string;
      ssh_password_mode: 'keep' | 'replace' | 'clear';
      connect_timeout_seconds: number | null;
      runtime_root: string;
      bootstrap_strategy: DesktopSSHEnvironmentDetails['bootstrap_strategy'];
      release_base_url: string;
    }
  | {
      kind: 'upsert_gateway';
      gateway_id?: string;
      display_name: string;
      connection_kind: 'ssh_container';
      ssh_destination: string;
      ssh_port: number | null;
      auth_mode: DesktopSSHEnvironmentDetails['auth_mode'];
      ssh_password: string;
      ssh_password_mode: 'keep' | 'replace' | 'clear';
      connect_timeout_seconds: number | null;
      container_engine: DesktopContainerEngine;
      container_id: string;
      container_ref: string;
      container_label: string;
      runtime_root: string;
    }
  | {
      kind: 'pair_gateway';
      gateway_id: string;
      start_policy?: DesktopGatewayStartPolicy;
    }
  | {
      kind: 'sync_gateway';
      gateway_id: string;
      start_policy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
  | {
      kind: 'set_gateway_enabled';
      gateway_id: string;
      enabled: boolean;
    }
  | {
      kind: 'start_gateway';
      gateway_id: string;
    }
  | {
      kind: 'stop_gateway';
      gateway_id: string;
      impact_acknowledged?: boolean;
    }
  | {
      kind: 'restart_gateway';
      gateway_id: string;
      impact_acknowledged?: boolean;
    }
  | {
      kind: 'update_gateway';
      gateway_id: string;
      impact_acknowledged?: boolean;
    }
  | {
      kind: 'refresh_gateway_status';
      gateway_id: string;
    }
  | {
      kind: 'upsert_gateway_environment_profile';
      gateway_id: string;
      gateway_env_id?: string;
      display_name: string;
      access_route: Readonly<{
        kind: 'url' | 'ssh_host' | 'ssh_container';
        url?: string;
        origin_label?: string;
        ssh_destination?: string;
        ssh_port?: number | null;
        auth_mode?: 'key_agent' | 'password';
        ssh_runtime_root?: string;
        container_engine?: string;
        container_id?: string;
        container_runtime_root?: string;
      }>;
      ssh_secret?: Readonly<{
        mode: 'keep' | 'replace' | 'clear';
        password?: string;
      }>;
      control_owner?: 'none' | 'gateway';
    }
  | {
      kind: 'delete_gateway_environment_profile';
      gateway_id: string;
      gateway_env_id: string;
    }
  | {
      kind: 'run_gateway_environment_lifecycle';
      environment_id: string;
      gateway_id: string;
      gateway_env_id: string;
      operation: 'start' | 'stop' | 'restart' | 'update_runtime';
      label?: string;
    }
  | {
      kind: 'refresh_gateway_catalog';
      gateway_id: string;
      start_policy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>;
    }
  | {
      kind: 'delete_gateway';
      gateway_id: string;
    }
  | {
      kind: 'save_local_environment_settings';
      local_ui_bind: string;
      local_ui_password: string;
      local_ui_password_mode: 'keep' | 'replace' | 'clear';
      auto_runtime_probe_enabled: boolean;
    }
  | {
      kind: 'upsert_saved_environment';
      environment_id: string;
      label: string;
      external_local_ui_url: string;
      auto_runtime_probe_enabled: boolean;
    }
  | ({
      kind: 'upsert_saved_ssh_environment';
      environment_id: string;
      label: string;
      ssh_password: string;
      ssh_password_mode: 'keep' | 'replace' | 'clear';
      auto_runtime_probe_enabled: boolean;
    } & DesktopSSHEnvironmentDetails)
  | ({
      kind: 'upsert_saved_runtime_target';
      environment_id?: string;
      label: string;
      auto_runtime_probe_enabled: boolean;
    } & Required<Pick<DesktopLauncherRuntimeTarget, 'host_access' | 'placement'>>
      & Pick<DesktopLauncherRuntimeTarget, 'ssh_password' | 'ssh_password_mode'>)
  | {
      kind: 'delete_saved_environment';
      environment_id: string;
    }
  | {
      kind: 'delete_saved_ssh_environment';
      environment_id: string;
    }
  | {
      kind: 'delete_saved_runtime_target';
      environment_id: string;
    }
  | {
      kind: 'cancel_launcher_operation';
      operation_key: string;
    }
  | {
      kind: 'dismiss_launcher_operation';
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
  gateway_id?: string;
  gateway_label?: string;
  gateway_environment_id?: string;
  operation_key?: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  should_refresh_snapshot?: boolean;
  failure?: DesktopOperationFailurePresentation;
  retry_action?: DesktopLauncherActionRequest;
  continuation_action?: DesktopLauncherActionRequest;
  resolve_focus?: DesktopGatewayResolveFocus;
  gateway_start_required_payload?: DesktopGatewayStartRequiredPayload;
}>;

export type DesktopLauncherActionResult = DesktopLauncherActionSuccess | DesktopLauncherActionFailure;

export type DesktopLauncherActionProgress = Readonly<{
  action: DesktopLauncherActionKind;
  environment_id?: string;
  environment_label?: string;
  gateway_id?: string;
  gateway_environment_id?: string;
  operation_key?: string;
  subject_kind?: DesktopLauncherOperationSubjectKind;
  subject_id?: string;
  started_at_unix_ms?: number;
  updated_at_unix_ms?: number;
  status?: DesktopLauncherOperationStatus;
  phase: string;
  title: string;
  title_key?: DesktopTranslationKey;
  detail: string;
  detail_key?: DesktopTranslationKey;
  lifecycle_progress?: DesktopRuntimeLifecycleProgress;
  open_progress?: DesktopOpenConnectionProgress;
  step_progress?: DesktopStepProgress;
  cancelable?: boolean;
  interrupt_label?: string;
  interrupt_label_key?: DesktopTranslationKey;
  interrupt_detail?: string;
  interrupt_detail_key?: DesktopTranslationKey;
  interrupt_kind?: 'stop_opening' | 'cleanup_deleted_subject' | 'generic';
  deleted_subject?: boolean;
  next_actions?: readonly DesktopLauncherOperationNextAction[];
  failure?: DesktopOperationFailurePresentation;
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

function normalizeSSHPasswordMode(value: unknown): 'keep' | 'replace' | 'clear' {
  const mode = compact(value);
  return mode === 'keep' || mode === 'clear' ? mode : 'replace';
}

function normalizeGatewayStartPolicy(
  value: unknown,
  allowed: readonly DesktopGatewayStartPolicy[],
): DesktopGatewayStartPolicy | undefined {
  const policy = compact(value) as DesktopGatewayStartPolicy;
  return allowed.includes(policy) ? policy : undefined;
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
  const remoteInstallDir = compact(candidate.runtime_root);
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
    ...(remoteInstallDir !== '' ? { runtime_root: remoteInstallDir } : {}),
    ...(bootstrapStrategy !== '' ? { bootstrap_strategy: bootstrapStrategy as DesktopSSHEnvironmentDetails['bootstrap_strategy'] } : {}),
    ...(releaseBaseURL !== '' ? { release_base_url: releaseBaseURL } : {}),
    ...(candidate.connect_timeout_seconds != null ? { connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds(candidate.connect_timeout_seconds) } : {}),
    ...(candidate.force_runtime_update === true ? { force_runtime_update: true } : {}),
    ...(candidate.auto_runtime_probe_enabled === true ? { auto_runtime_probe_enabled: true } : {}),
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
    case 'open_flower_host':
      return { kind };
    case 'open_environment_center':
      return { kind };
    case 'open_environment_settings': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
      };
    }
    case 'open_local_environment': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      const target = normalizeDesktopLauncherRuntimeTarget(candidate as Record<string, unknown>);
      return {
        kind,
        environment_id: environmentID,
        ...(target ?? {}),
        route: (() => {
          const route = compact((candidate as { route?: unknown }).route);
          if (route === 'local_host' || route === 'remote_desktop') {
            return route;
          }
          return 'auto';
        })(),
      } as DesktopLauncherActionRequest;
    }
    case 'open_provider_environment': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        route: (() => {
          const route = compact((candidate as { route?: unknown }).route);
          if (route === 'local_host' || route === 'remote_desktop') {
            return route;
          }
          return 'auto';
        })(),
      };
    }
    case 'open_gateway_environment': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id);
      const gatewayEnvID = compact((candidate as { gateway_env_id?: unknown }).gateway_env_id);
      const label = compact((candidate as { label?: unknown }).label);
      if (environmentID === '' || gatewayID === '' || gatewayEnvID === '' || label === '') {
        return null;
      }
      const startPolicy = normalizeGatewayStartPolicy(
        (candidate as { start_policy?: unknown }).start_policy,
        ['start_if_needed'],
      );
      return {
        kind,
        environment_id: environmentID,
        gateway_id: gatewayID,
        gateway_env_id: gatewayEnvID,
        label,
        ...(startPolicy ? { start_policy: startPolicy as Extract<DesktopGatewayStartPolicy, 'start_if_needed'> } : {}),
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
      if (kind === 'connect_provider_runtime' && !target.provider_environment_id) {
        return null;
      }
      return {
        kind,
        ...target,
      } as DesktopLauncherActionRequest;
    }
    case 'start_environment_runtime':
    case 'restart_environment_runtime':
    case 'update_environment_runtime':
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
    case 'manage_desktop_update': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        label: compact((candidate as { label?: unknown }).label) || undefined,
      };
    }
    case 'refresh_all_environment_runtimes':
      return { kind };
    case 'prepare_environment_open': {
      const target = normalizeDesktopLauncherRuntimeTarget(candidate as Record<string, unknown>);
      if (!target) {
        return null;
      }
      return {
        kind,
        ...target,
      } as DesktopLauncherActionRequest;
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
        const target = normalizeDesktopLauncherRuntimeTarget(candidate as Record<string, unknown>);
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        label: compact((candidate as { label?: unknown }).label) || undefined,
        ...(target ?? {}),
        ssh_destination: compact((candidate as { ssh_destination?: unknown }).ssh_destination),
        ssh_port: (candidate as { ssh_port?: unknown }).ssh_port == null || sshPortText === ''
          ? null
          : Number.parseInt(sshPortText, 10),
        auth_mode: compact((candidate as { auth_mode?: unknown }).auth_mode) as DesktopSSHEnvironmentDetails['auth_mode'],
        runtime_root: compact((candidate as { runtime_root?: unknown }).runtime_root),
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
          runtime_root: compact((candidate as { runtime_root?: unknown }).runtime_root),
          bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
          release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
          connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
        };
      }
    case 'set_saved_runtime_target_pinned': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      if (environmentID === '') {
        return null;
      }
      let hostAccess: DesktopRuntimeHostAccess;
      let placement: DesktopRuntimePlacement;
      try {
        hostAccess = normalizeDesktopRuntimeHostAccess((candidate as { host_access?: unknown }).host_access);
        placement = normalizeDesktopRuntimePlacement((candidate as { placement?: unknown }).placement);
      } catch {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        label: compact((candidate as { label?: unknown }).label),
        pinned: (candidate as { pinned?: unknown }).pinned === true,
        host_access: hostAccess,
        placement,
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
        auto_runtime_probe_enabled: (candidate as { auto_runtime_probe_enabled?: unknown }).auto_runtime_probe_enabled === true,
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
    case 'upsert_gateway': {
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id) || undefined;
      const displayName = compact((candidate as { display_name?: unknown }).display_name);
      const connectionKind = compact((candidate as { connection_kind?: unknown }).connection_kind);
      if (connectionKind === '' || connectionKind === 'url') {
        const gatewayURL = compact((candidate as { gateway_url?: unknown }).gateway_url);
        if (gatewayURL === '') {
          return null;
        }
        return {
          kind,
          gateway_id: gatewayID,
	          display_name: displayName,
	          connection_kind: 'url',
	          gateway_url: gatewayURL,
	          ...(compact((candidate as { pairing_code?: unknown }).pairing_code)
	            ? { pairing_code: compact((candidate as { pairing_code?: unknown }).pairing_code) }
	            : {}),
	          allow_loopback_http: (candidate as { allow_loopback_http?: unknown }).allow_loopback_http === true,
	        };
      }
      if (connectionKind === 'ssh_host') {
        try {
          const runtimeRoot = normalizeDesktopSSHRuntimeRoot((candidate as { runtime_root?: unknown }).runtime_root);
          return {
            kind,
            gateway_id: gatewayID,
            display_name: displayName,
            connection_kind: 'ssh_host',
            ssh_destination: normalizeDesktopSSHDestination((candidate as { ssh_destination?: unknown }).ssh_destination),
            ssh_port: normalizeDesktopSSHPort((candidate as { ssh_port?: unknown }).ssh_port),
            auth_mode: normalizeDesktopSSHAuthMode((candidate as { auth_mode?: unknown }).auth_mode),
            ssh_password: String((candidate as { ssh_password?: unknown }).ssh_password ?? ''),
            ssh_password_mode: normalizeSSHPasswordMode((candidate as { ssh_password_mode?: unknown }).ssh_password_mode),
            connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
            runtime_root: runtimeRoot,
            bootstrap_strategy: normalizeDesktopSSHBootstrapStrategy((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy),
            release_base_url: normalizeDesktopSSHReleaseBaseURL((candidate as { release_base_url?: unknown }).release_base_url),
          };
        } catch {
          return null;
        }
      }
      if (connectionKind === 'ssh_container') {
        const containerID = compact((candidate as { container_id?: unknown }).container_id);
        if (containerID === '') {
          return null;
        }
        try {
          const runtimeRoot = normalizeDesktopSSHRuntimeRoot((candidate as { runtime_root?: unknown }).runtime_root);
          return {
            kind,
            gateway_id: gatewayID,
            display_name: displayName,
            connection_kind: 'ssh_container',
            ssh_destination: normalizeDesktopSSHDestination((candidate as { ssh_destination?: unknown }).ssh_destination),
            ssh_port: normalizeDesktopSSHPort((candidate as { ssh_port?: unknown }).ssh_port),
            auth_mode: normalizeDesktopSSHAuthMode((candidate as { auth_mode?: unknown }).auth_mode),
            ssh_password: String((candidate as { ssh_password?: unknown }).ssh_password ?? ''),
            ssh_password_mode: normalizeSSHPasswordMode((candidate as { ssh_password_mode?: unknown }).ssh_password_mode),
            connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
            container_engine: normalizeDesktopContainerEngine((candidate as { container_engine?: unknown }).container_engine),
            container_id: containerID,
            container_ref: compact((candidate as { container_ref?: unknown }).container_ref) || compact((candidate as { container_label?: unknown }).container_label) || containerID,
            container_label: compact((candidate as { container_label?: unknown }).container_label) || containerID,
            runtime_root: runtimeRoot,
          };
        } catch {
          return null;
        }
      }
      return null;
    }
    case 'pair_gateway':
    case 'sync_gateway':
    case 'set_gateway_enabled':
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
    case 'refresh_gateway_status':
    case 'refresh_gateway_catalog':
    case 'delete_gateway': {
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id);
      if (gatewayID === '') {
        return null;
      }
      if (kind === 'pair_gateway') {
        const startPolicy = normalizeGatewayStartPolicy(
          (candidate as { start_policy?: unknown }).start_policy,
          ['require_ready', 'start_if_needed'],
        );
        return {
          kind,
          gateway_id: gatewayID,
          ...(startPolicy ? { start_policy: startPolicy } : {}),
        };
      }
      if (kind === 'sync_gateway') {
        const startPolicy = normalizeGatewayStartPolicy((candidate as { start_policy?: unknown }).start_policy, ['start_if_needed']);
        return {
          kind,
          gateway_id: gatewayID,
          ...(startPolicy ? { start_policy: startPolicy as Extract<DesktopGatewayStartPolicy, 'start_if_needed'> } : {}),
        };
      }
      if (kind === 'set_gateway_enabled') {
        return {
          kind,
          gateway_id: gatewayID,
          enabled: (candidate as { enabled?: unknown }).enabled !== false,
        };
      }
      if (kind === 'refresh_gateway_catalog') {
        const startPolicy = normalizeGatewayStartPolicy((candidate as { start_policy?: unknown }).start_policy, ['start_if_needed']);
        return {
          kind,
          gateway_id: gatewayID,
          ...(startPolicy ? { start_policy: startPolicy as Extract<DesktopGatewayStartPolicy, 'start_if_needed'> } : {}),
        };
      }
      if (kind === 'stop_gateway' || kind === 'restart_gateway' || kind === 'update_gateway') {
        return {
          kind,
          gateway_id: gatewayID,
          ...(((candidate as { impact_acknowledged?: unknown }).impact_acknowledged === true)
            ? { impact_acknowledged: true }
            : {}),
        } as DesktopLauncherActionRequest;
      }
      if (kind === 'refresh_gateway_status') {
        return {
          kind,
          gateway_id: gatewayID,
        };
      }
      return {
        kind,
        gateway_id: gatewayID,
      };
    }
    case 'upsert_gateway_environment_profile': {
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id);
      const displayName = compact((candidate as { display_name?: unknown }).display_name);
      const accessRouteRaw = (candidate as { access_route?: unknown }).access_route;
      const accessRoute = accessRouteRaw && typeof accessRouteRaw === 'object'
        ? accessRouteRaw as Record<string, unknown>
        : {};
      const routeKind = compact(accessRoute.kind);
      if (gatewayID === '' || displayName === '' || (routeKind !== 'url' && routeKind !== 'ssh_host' && routeKind !== 'ssh_container')) {
        return null;
      }
      const sshPort = normalizeDesktopSSHPort(accessRoute.ssh_port);
      const normalizedRoute = {
        kind: routeKind,
        url: compact(accessRoute.url) || undefined,
        origin_label: compact(accessRoute.origin_label) || undefined,
        ssh_destination: compact(accessRoute.ssh_destination) || undefined,
        ...(sshPort == null ? {} : { ssh_port: sshPort }),
        ...(routeKind === 'ssh_host' || routeKind === 'ssh_container'
          ? { auth_mode: compact(accessRoute.auth_mode) === 'password' ? 'password' : 'key_agent' }
          : {}),
        ssh_runtime_root: compact(accessRoute.ssh_runtime_root) || undefined,
        container_engine: compact(accessRoute.container_engine) || undefined,
        container_id: compact(accessRoute.container_id) || undefined,
        container_runtime_root: compact(accessRoute.container_runtime_root) || undefined,
      } as Extract<DesktopLauncherActionRequest, { kind: 'upsert_gateway_environment_profile' }>['access_route'];
      if (routeKind === 'url' && !normalizedRoute.url) {
        return null;
      }
      if ((routeKind === 'ssh_host' || routeKind === 'ssh_container') && !normalizedRoute.ssh_destination) {
        return null;
      }
      if (routeKind === 'ssh_container' && !normalizedRoute.container_id) {
        return null;
      }
      return {
        kind,
        gateway_id: gatewayID,
        gateway_env_id: compact((candidate as { gateway_env_id?: unknown }).gateway_env_id) || undefined,
        display_name: displayName,
        access_route: normalizedRoute,
        ssh_secret: normalizeGatewayProfileSSHSecret((candidate as { ssh_secret?: unknown }).ssh_secret),
        control_owner: compact((candidate as { control_owner?: unknown }).control_owner) === 'gateway' ? 'gateway' : 'none',
      };
    }
    case 'delete_gateway_environment_profile': {
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id);
      const gatewayEnvID = compact((candidate as { gateway_env_id?: unknown }).gateway_env_id);
      if (gatewayID === '' || gatewayEnvID === '') {
        return null;
      }
      return {
        kind,
        gateway_id: gatewayID,
        gateway_env_id: gatewayEnvID,
      };
    }
    case 'run_gateway_environment_lifecycle': {
      const environmentID = compact((candidate as { environment_id?: unknown }).environment_id);
      const gatewayID = compact((candidate as { gateway_id?: unknown }).gateway_id);
      const gatewayEnvID = compact((candidate as { gateway_env_id?: unknown }).gateway_env_id);
      const operation = compact((candidate as { operation?: unknown }).operation);
      if (
        environmentID === ''
        || gatewayID === ''
        || gatewayEnvID === ''
        || (operation !== 'start' && operation !== 'stop' && operation !== 'restart' && operation !== 'update_runtime')
      ) {
        return null;
      }
      return {
        kind,
        environment_id: environmentID,
        gateway_id: gatewayID,
        gateway_env_id: gatewayEnvID,
        operation,
        label: compact((candidate as { label?: unknown }).label) || undefined,
      };
    }
    case 'upsert_saved_environment':
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id),
        label: compact((candidate as { label?: unknown }).label),
        external_local_ui_url: compact((candidate as { external_local_ui_url?: unknown }).external_local_ui_url),
        auto_runtime_probe_enabled: (candidate as { auto_runtime_probe_enabled?: unknown }).auto_runtime_probe_enabled === true,
      };
    case 'upsert_saved_ssh_environment':
      {
        const sshPortText = compact((candidate as { ssh_port?: unknown }).ssh_port);
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id),
        label: compact((candidate as { label?: unknown }).label),
        ssh_password: String((candidate as { ssh_password?: unknown }).ssh_password ?? ''),
        ssh_password_mode: normalizeSSHPasswordMode((candidate as { ssh_password_mode?: unknown }).ssh_password_mode),
        ssh_destination: compact((candidate as { ssh_destination?: unknown }).ssh_destination),
        ssh_port: (candidate as { ssh_port?: unknown }).ssh_port == null || sshPortText === ''
          ? null
          : Number.parseInt(sshPortText, 10),
        auth_mode: compact((candidate as { auth_mode?: unknown }).auth_mode) as DesktopSSHEnvironmentDetails['auth_mode'],
        runtime_root: compact((candidate as { runtime_root?: unknown }).runtime_root),
        bootstrap_strategy: compact((candidate as { bootstrap_strategy?: unknown }).bootstrap_strategy) as DesktopSSHEnvironmentDetails['bootstrap_strategy'],
        release_base_url: compact((candidate as { release_base_url?: unknown }).release_base_url),
        connect_timeout_seconds: normalizeDesktopSSHConnectTimeoutSeconds((candidate as { connect_timeout_seconds?: unknown }).connect_timeout_seconds),
        auto_runtime_probe_enabled: (candidate as { auto_runtime_probe_enabled?: unknown }).auto_runtime_probe_enabled === true,
      };
      }
    case 'upsert_saved_runtime_target': {
      let hostAccess: DesktopRuntimeHostAccess;
      let placement: DesktopRuntimePlacement;
      try {
        hostAccess = normalizeDesktopRuntimeHostAccess((candidate as { host_access?: unknown }).host_access);
        placement = normalizeDesktopRuntimePlacement((candidate as { placement?: unknown }).placement);
      } catch {
        return null;
      }
      return {
        kind,
        environment_id: compact((candidate as { environment_id?: unknown }).environment_id) || undefined,
        label: compact((candidate as { label?: unknown }).label),
        host_access: hostAccess,
        placement,
        ssh_password: String((candidate as { ssh_password?: unknown }).ssh_password ?? ''),
        ssh_password_mode: normalizeSSHPasswordMode((candidate as { ssh_password_mode?: unknown }).ssh_password_mode),
        auto_runtime_probe_enabled: (candidate as { auto_runtime_probe_enabled?: unknown }).auto_runtime_probe_enabled === true,
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
    case 'delete_saved_runtime_target': {
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
    case 'dismiss_launcher_operation': {
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
