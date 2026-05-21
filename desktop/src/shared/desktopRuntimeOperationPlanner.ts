import type { DesktopRuntimeControlStatus } from './desktopRuntimePresence';
import {
  desktopRuntimeMaintenanceRequiresRestart,
  desktopRuntimeMaintenanceRequiresUpdate,
  type DesktopRuntimeMaintenanceRequirement,
} from './desktopRuntimeHealth';
import type { DesktopRuntimePackageState } from './desktopRuntimePackageState';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from './desktopRuntimePlacement';
import type { RuntimeServiceSnapshot } from './runtimeService';
import {
  runtimeServiceHasActiveWork,
  runtimeServiceIsOpenable,
} from './runtimeService';
import {
  desktopRuntimeOperationPlan,
  hiddenDesktopRuntimeOperationPlan,
  type DesktopRuntimeOperationMethod,
  type DesktopRuntimeOperationPlans,
} from './desktopRuntimeOperations';

type MissingRuntimeControlStatus = Extract<DesktopRuntimeControlStatus, Readonly<{ state: 'missing' }>>;

export type DesktopRuntimeOperationPlanningSurface =
  | 'managed_runtime_card'
  | 'provider_card'
  | 'external_local_ui';

export type DesktopRuntimeOperationPlannerInput = Readonly<{
  surface: DesktopRuntimeOperationPlanningSurface;
  host_access?: DesktopRuntimeHostAccess;
  placement?: DesktopRuntimePlacement;
  running: boolean;
  openable: boolean;
  open_connection_required?: boolean;
  package_state?: DesktopRuntimePackageState;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_control_status?: DesktopRuntimeControlStatus;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
}>;

function managementMethod(
  hostAccess: DesktopRuntimeHostAccess | undefined,
  placement: DesktopRuntimePlacement | undefined,
): DesktopRuntimeOperationMethod {
  if (!hostAccess || !placement) {
    return 'none';
  }
  if (placement.kind === 'container_process') {
    return hostAccess.kind === 'ssh_host' ? 'ssh_container_exec' : 'local_container_exec';
  }
  return hostAccess.kind === 'ssh_host' ? 'ssh_host' : 'local_host';
}

function packageRequiresUpdate(packageState: DesktopRuntimePackageState | undefined): boolean {
  return packageState?.state === 'outdated' || packageState?.state === 'incompatible';
}

function updateRequiredMessage(packageState: DesktopRuntimePackageState | undefined): string {
  if (!packageState) {
    return 'Update this runtime before continuing.';
  }
  if (packageState.state === 'outdated') {
    return `Update this runtime from ${packageState.current_version} to ${packageState.target_version} before continuing.`;
  }
  if (packageState.state === 'incompatible') {
    return packageState.reason || 'Update this incompatible runtime before continuing.';
  }
  return 'Update this runtime before continuing.';
}

function localDesktopUpdateMessage(packageState: DesktopRuntimePackageState | undefined): string {
  if (packageState?.state === 'outdated') {
    return `Update Redeven Desktop to bring the bundled runtime from ${packageState.current_version} to ${packageState.target_version}.`;
  }
  if (packageState?.state === 'incompatible') {
    return packageState.reason || 'Update Redeven Desktop before continuing with this local runtime.';
  }
  return 'Update Redeven Desktop before continuing with this local runtime.';
}

function activeWorkMessage(runtimeService: RuntimeServiceSnapshot | undefined): string {
  return runtimeServiceHasActiveWork(runtimeService)
    ? 'Active work may be interrupted. Confirm before changing this runtime.'
    : '';
}

function runtimeTargetUnavailableStatus(
  runtimeControlStatus: DesktopRuntimeControlStatus | undefined,
  openConnectionRequired: boolean,
): MissingRuntimeControlStatus | null {
  if (runtimeControlStatus?.state !== 'missing') {
    return null;
  }
  if (runtimeControlStatus.reason_code === 'container_not_running'
    || runtimeControlStatus.reason_code === 'container_engine_unavailable') {
    return runtimeControlStatus;
  }
  return runtimeControlStatus.reason_code === 'forward_unavailable' && !openConnectionRequired
    ? runtimeControlStatus
    : null;
}

export function buildDesktopRuntimeOperationPlans(
  input: DesktopRuntimeOperationPlannerInput,
): DesktopRuntimeOperationPlans {
  const hidden = {
    open: hiddenDesktopRuntimeOperationPlan('open'),
    refresh: hiddenDesktopRuntimeOperationPlan('refresh'),
    start: hiddenDesktopRuntimeOperationPlan('start'),
    stop: hiddenDesktopRuntimeOperationPlan('stop'),
    restart: hiddenDesktopRuntimeOperationPlan('restart'),
    update: hiddenDesktopRuntimeOperationPlan('update'),
    connect_provider: hiddenDesktopRuntimeOperationPlan('connect_provider'),
    disconnect_provider: hiddenDesktopRuntimeOperationPlan('disconnect_provider'),
  };
  if (input.surface === 'provider_card') {
    return {
      ...hidden,
      open: desktopRuntimeOperationPlan('open', input.openable ? 'available' : 'blocked', 'provider_tunnel', {
        reasonCode: input.openable ? undefined : 'provider_route_unavailable',
        message: input.openable ? undefined : 'Refresh provider status before opening this environment.',
      }),
      refresh: desktopRuntimeOperationPlan('refresh', 'available', 'provider_tunnel'),
    };
  }
  if (input.surface === 'external_local_ui') {
    return {
      ...hidden,
      open: desktopRuntimeOperationPlan('open', input.openable ? 'available' : 'blocked', 'none', {
        reasonCode: input.openable ? undefined : 'external_target_unreachable',
        message: input.openable ? undefined : 'This Local UI target is unavailable right now.',
      }),
      refresh: desktopRuntimeOperationPlan('refresh', 'available', 'none'),
    };
  }

  const method = managementMethod(input.host_access, input.placement);
  const updateMethod: DesktopRuntimeOperationMethod = method === 'local_host'
    ? 'desktop_local_update_handoff'
    : method;
  const hasManagement = method !== 'none';
  const requiresUpdate = packageRequiresUpdate(input.package_state);
  const maintenance = input.maintenance;
  const restartMaintenance = desktopRuntimeMaintenanceRequiresRestart(maintenance);
  const updateMaintenance = desktopRuntimeMaintenanceRequiresUpdate(maintenance);
  const openConnectionRequired = input.open_connection_required === true;
  const blockedByUpdate = requiresUpdate || updateMaintenance;
  const updateMessage = updateMethod === 'desktop_local_update_handoff'
    ? localDesktopUpdateMessage(input.package_state)
    : updateRequiredMessage(input.package_state);
  const canOpen = input.openable || openConnectionRequired;
  const managementBlockedStatus = runtimeTargetUnavailableStatus(input.runtime_control_status, openConnectionRequired);
  const managementBlocked = !!managementBlockedStatus;
  const blockedByRecoveryMaintenance = restartMaintenance;
  const openAvailability = input.running && canOpen && !blockedByUpdate && !blockedByRecoveryMaintenance && !managementBlocked
    ? 'available'
    : 'blocked';
  const openMessage = managementBlocked
    ? managementBlockedStatus.message
    : blockedByUpdate || blockedByRecoveryMaintenance
      ? maintenance?.message ?? updateMessage
    : !input.running
    ? 'Start this runtime before opening it.'
    : canOpen
      ? undefined
      : 'Runtime is not ready to open yet.';

  return {
    open: desktopRuntimeOperationPlan('open', openAvailability, method, {
      reasonCode: openAvailability === 'available'
        ? undefined
        : managementBlocked
          ? 'runtime_target_unavailable'
          : !input.running
            ? 'runtime_not_started'
            : 'runtime_not_openable',
      message: openMessage,
      packageState: input.package_state,
      maintenance,
    }),
    refresh: desktopRuntimeOperationPlan('refresh', 'available', method, {
      menuVisibility: 'contextual',
    }),
    start: desktopRuntimeOperationPlan(
      'start',
      hasManagement
        ? input.running
          ? 'unavailable'
          : managementBlocked
            ? 'blocked'
          : blockedByUpdate
            ? 'blocked'
            : 'available'
        : 'hidden',
      method,
      {
        reasonCode: managementBlocked ? 'runtime_target_unavailable' : blockedByUpdate ? 'runtime_update_required' : input.running ? 'runtime_already_running' : undefined,
        message: managementBlocked ? managementBlockedStatus.message : blockedByUpdate ? updateMessage : undefined,
        packageState: input.package_state,
        maintenance,
        menuVisibility: hasManagement && !input.running ? 'contextual' : 'hidden',
      },
    ),
    stop: desktopRuntimeOperationPlan(
      'stop',
      hasManagement ? input.running ? 'available' : 'unavailable' : 'hidden',
      method,
      {
        reasonCode: input.running ? undefined : 'runtime_not_started',
        message: input.running ? activeWorkMessage(input.runtime_service) : 'Runtime is not running.',
        menuVisibility: hasManagement ? 'stable' : 'hidden',
      },
    ),
    restart: desktopRuntimeOperationPlan(
      'restart',
      hasManagement
        ? managementBlocked
          ? 'blocked'
          : blockedByUpdate
            ? 'blocked'
            : 'available'
        : 'hidden',
      method,
      {
        reasonCode: managementBlocked
          ? 'runtime_target_unavailable'
          : blockedByUpdate
          ? 'runtime_update_required'
          : undefined,
        message: managementBlocked
          ? managementBlockedStatus.message
          : blockedByUpdate
          ? updateMessage
          : maintenance?.message ?? activeWorkMessage(input.runtime_service),
        packageState: input.package_state,
        maintenance,
        menuVisibility: hasManagement ? 'stable' : 'hidden',
      },
    ),
    update: desktopRuntimeOperationPlan(
      'update',
      hasManagement
        ? managementBlocked
          ? 'blocked'
          : 'available'
        : 'hidden',
      updateMethod,
      {
        reasonCode: blockedByUpdate ? 'runtime_update_required' : undefined,
        label: updateMethod === 'desktop_local_update_handoff' ? 'Update Redeven Desktop' : undefined,
        message: managementBlocked ? managementBlockedStatus.message : maintenance?.message ?? updateMessage,
        packageState: input.package_state,
        maintenance,
        menuVisibility: hasManagement ? 'stable' : 'hidden',
      },
    ),
    connect_provider: desktopRuntimeOperationPlan(
      'connect_provider',
      input.runtime_control_status?.state === 'available' && runtimeServiceIsOpenable(input.runtime_service)
        ? 'available'
        : 'blocked',
      'runtime_control_rpc',
      {
        reasonCode: input.runtime_control_status?.state === 'owner_mismatch'
          ? 'runtime_control_owner_mismatch'
          : input.runtime_control_status?.state === 'missing'
            ? 'runtime_control_missing'
            : undefined,
        message: input.runtime_control_status?.state === 'owner_mismatch' || input.runtime_control_status?.state === 'missing'
          ? input.runtime_control_status.message
          : undefined,
      },
    ),
    disconnect_provider: desktopRuntimeOperationPlan('disconnect_provider', 'available', 'runtime_control_rpc', {
      requiresConfirmation: true,
    }),
  };
}
