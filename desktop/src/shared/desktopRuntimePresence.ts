import type { DesktopRuntimeMaintenanceRequirement } from './desktopRuntimeHealth';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
  DesktopRuntimeTargetID,
} from './desktopRuntimePlacement';
import type { DesktopProviderRuntimeLinkTargetID } from './providerRuntimeLinkTarget';
import type { RuntimeServiceSnapshot } from './runtimeService';

export type DesktopRuntimeControlStatus =
  | Readonly<{
      state: 'available';
      owner: 'current_desktop';
    }>
  | Readonly<{
      state: 'owner_mismatch';
      owner: 'other_desktop' | 'unknown';
      message: string;
    }>
  | Readonly<{
      state: 'missing';
      reason_code: 'not_started' | 'not_reported' | 'forward_unavailable';
      message: string;
    }>;

export type DesktopManagedRuntimeLifecycleControl = 'start_stop' | 'observe_only';

export type DesktopManagedRuntimePresence = Readonly<{
  target_id: DesktopProviderRuntimeLinkTargetID;
  placement_target_id: DesktopRuntimeTargetID;
  kind: 'local_environment' | 'ssh_environment';
  environment_id: string;
  label: string;
  runtime_key: string;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  running: boolean;
  local_ui_url: string;
  openable: boolean;
  lifecycle_control: DesktopManagedRuntimeLifecycleControl;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_status: DesktopRuntimeControlStatus;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
  checked_at_unix_ms: number;
}>;

export type DesktopManagedRuntimeLifecycleIntent =
  | 'start_runtime'
  | 'stop_runtime'
  | 'restart_runtime'
  | 'update_runtime'
  | 'refresh_runtime';

export type DesktopManagedRuntimeLifecycleAction = Readonly<{
  intent: DesktopManagedRuntimeLifecycleIntent;
  label: string;
  primary: boolean;
}>;

const missingNotStarted: DesktopRuntimeControlStatus = {
  state: 'missing',
  reason_code: 'not_started',
  message: 'Start this runtime before connecting it to a provider.',
};

export function desktopRuntimeControlStatusAvailable(): DesktopRuntimeControlStatus {
  return {
    state: 'available',
    owner: 'current_desktop',
  };
}

export function desktopRuntimeControlStatusMissing(
  reasonCode: Extract<DesktopRuntimeControlStatus, { state: 'missing' }>['reason_code'],
  message: string,
): DesktopRuntimeControlStatus {
  return {
    state: 'missing',
    reason_code: reasonCode,
    message: String(message ?? '').trim() || 'Runtime-control is not available for this runtime.',
  };
}

export function desktopRuntimeControlStatusOwnerMismatch(message: string): DesktopRuntimeControlStatus {
  return {
    state: 'owner_mismatch',
    owner: 'other_desktop',
    message: String(message ?? '').trim() || 'This runtime is owned by another Desktop instance.',
  };
}

// IMPORTANT: Runtime Presence is the sole renderer-facing source of Local/SSH
// runtime management capability. Do not derive runtime-control availability
// from open window sessions or provider route status.
export function defaultRuntimeControlStatusForRunningState(running: boolean): DesktopRuntimeControlStatus {
  return running
    ? desktopRuntimeControlStatusMissing('not_reported', 'Restart this runtime from Desktop so runtime-control can be prepared.')
    : missingNotStarted;
}

// IMPORTANT: Local and SSH cards are both managed runtime cards. Their host
// access differs, but lifecycle action semantics must stay shared.
export function desktopManagedRuntimeLifecycleActions(
  presence: Pick<DesktopManagedRuntimePresence, 'running' | 'lifecycle_control' | 'maintenance' | 'placement'>,
): readonly DesktopManagedRuntimeLifecycleAction[] {
  if (presence.lifecycle_control !== 'start_stop') {
    return [
      {
        intent: 'refresh_runtime',
        label: 'Refresh runtime status',
        primary: false,
      },
    ];
  }

  const actions: DesktopManagedRuntimeLifecycleAction[] = [];
  if (presence.running) {
    actions.push({
      intent: 'stop_runtime',
      label: 'Stop runtime',
      primary: true,
    });
  } else {
    actions.push({
      intent: 'start_runtime',
      label: 'Start runtime',
      primary: true,
    });
  }

  if (presence.maintenance) {
    actions.push({
      intent: presence.maintenance.kind === 'ssh_runtime_restart_required' ? 'restart_runtime' : 'update_runtime',
      label: presence.maintenance.kind === 'ssh_runtime_restart_required' ? 'Restart runtime…' : 'Update and restart…',
      primary: false,
    });
  }

  actions.push({
    intent: 'refresh_runtime',
    label: 'Refresh runtime status',
    primary: false,
  });

  return actions;
}
