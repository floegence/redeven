import type { DesktopRuntimeMaintenanceRequirement } from './desktopRuntimeHealth';
import type { DesktopRuntimeOperationPlans } from './desktopRuntimeOperations';
import type { DesktopRuntimePackageState } from './desktopRuntimePackageState';
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
      reason_code:
        | 'not_started'
        | 'auth_required'
        | 'unverified'
        | 'container_not_running'
        | 'container_engine_unavailable'
        | 'not_reported'
        | 'forward_unavailable';
      message: string;
    }>;

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
  open_connection_required?: boolean;
  runtime_package_state?: DesktopRuntimePackageState;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_status: DesktopRuntimeControlStatus;
  operations: DesktopRuntimeOperationPlans;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
  checked_at_unix_ms: number;
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
