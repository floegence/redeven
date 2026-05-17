import type { DesktopRuntimeControlStatus } from './desktopRuntimePresence';
import type { DesktopRuntimeMaintenanceRequirement } from './desktopRuntimeHealth';
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

function activeWorkMessage(runtimeService: RuntimeServiceSnapshot | undefined): string {
  return runtimeServiceHasActiveWork(runtimeService)
    ? 'Active work may be interrupted. Confirm before changing this runtime.'
    : '';
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
  const hasManagement = method !== 'none';
  const requiresUpdate = packageRequiresUpdate(input.package_state);
  const maintenance = input.maintenance;
  const restartMaintenance = maintenance?.kind === 'ssh_runtime_restart_required';
  const updateMaintenance = maintenance?.kind === 'ssh_runtime_update_required'
    || maintenance?.kind === 'desktop_model_source_requires_runtime_update';
  const managementBlocked = input.runtime_control_status?.state === 'missing'
    && input.runtime_control_status.reason_code === 'forward_unavailable';
  const blockedByUpdate = requiresUpdate || updateMaintenance;
  const openAvailability = input.running && input.openable && !blockedByUpdate && !restartMaintenance
    ? 'available'
    : 'blocked';
  const openMessage = managementBlocked
    ? input.runtime_control_status?.message
    : !input.running
    ? 'Start this runtime before opening it.'
    : blockedByUpdate
      ? updateRequiredMessage(input.package_state)
      : restartMaintenance
        ? maintenance.message
        : input.openable
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
    refresh: desktopRuntimeOperationPlan('refresh', 'available', method),
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
        message: managementBlocked ? input.runtime_control_status?.message : blockedByUpdate ? updateRequiredMessage(input.package_state) : undefined,
        packageState: input.package_state,
        maintenance,
      },
    ),
    stop: desktopRuntimeOperationPlan(
      'stop',
      hasManagement ? input.running ? 'available' : 'unavailable' : 'hidden',
      method,
      {
        requiresConfirmation: input.running,
        reasonCode: input.running ? undefined : 'runtime_not_started',
        message: activeWorkMessage(input.runtime_service),
      },
    ),
    restart: desktopRuntimeOperationPlan(
      'restart',
      hasManagement
        ? input.running
          ? blockedByUpdate
            ? 'blocked'
            : 'available'
          : 'unavailable'
        : 'hidden',
      method,
      {
        requiresConfirmation: input.running,
        reasonCode: blockedByUpdate ? 'runtime_update_required' : input.running ? undefined : 'runtime_not_started',
        message: blockedByUpdate ? updateRequiredMessage(input.package_state) : maintenance?.message ?? activeWorkMessage(input.runtime_service),
        packageState: input.package_state,
        maintenance,
      },
    ),
    update: desktopRuntimeOperationPlan(
      'update',
      hasManagement && (blockedByUpdate || input.package_state?.state === 'unknown')
        ? 'available'
        : 'hidden',
      method,
      {
        requiresConfirmation: true,
        reasonCode: blockedByUpdate ? 'runtime_update_required' : undefined,
        message: maintenance?.message ?? updateRequiredMessage(input.package_state),
        packageState: input.package_state,
        maintenance,
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
