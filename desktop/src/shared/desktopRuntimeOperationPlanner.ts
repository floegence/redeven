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
  runtimeServiceAllowsOpenAttempt,
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
  | 'gateway_card'
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
  if (input.surface === 'gateway_card') {
    return {
      ...hidden,
      open: desktopRuntimeOperationPlan('open', input.openable ? 'available' : 'blocked', 'runtime_gateway', {
        reasonCode: input.openable ? undefined : 'gateway_route_unavailable',
        message: input.openable ? undefined : 'Refresh this Gateway before opening this environment.',
      }),
      refresh: desktopRuntimeOperationPlan('refresh', 'available', 'runtime_gateway', {
        label: 'Refresh Gateway',
      }),
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
  const maintenance = input.maintenance;
  const restartMaintenance = desktopRuntimeMaintenanceRequiresRestart(maintenance);
  const updateMaintenance = desktopRuntimeMaintenanceRequiresUpdate(maintenance);
  const openConnectionRequired = input.open_connection_required === true;
  const optimisticOpenMaintenance = Boolean(
    maintenance?.required_for === 'open'
    && updateMaintenance
    && runtimeServiceAllowsOpenAttempt(input.runtime_service),
  );
  const canOpen = input.openable
    || openConnectionRequired
    || updateMaintenance
    || runtimeServiceAllowsOpenAttempt(input.runtime_service);
  const managementBlockedStatus = runtimeTargetUnavailableStatus(input.runtime_control_status, openConnectionRequired);
  const managementBlocked = !!managementBlockedStatus;
  const lifecycleSetupMessage = 'Initialize this environment before using lifecycle actions.';
  const blockedByRecoveryMaintenance = restartMaintenance && !optimisticOpenMaintenance;
  const openAvailability = input.running && canOpen && !blockedByRecoveryMaintenance && !managementBlocked
    ? 'available'
    : 'blocked';
  const openMessage = managementBlocked
    ? managementBlockedStatus.message
    : blockedByRecoveryMaintenance
      ? maintenance?.message
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
      hasManagement ? 'blocked' : 'hidden',
      hasManagement ? 'runtime_gateway' : 'none',
      {
        reasonCode: hasManagement ? 'runtime_gateway_setup_required' : undefined,
        message: hasManagement ? lifecycleSetupMessage : undefined,
        packageState: input.package_state,
        maintenance,
        menuVisibility: hasManagement ? 'contextual' : 'hidden',
      },
    ),
    stop: desktopRuntimeOperationPlan(
      'stop',
      hasManagement ? 'blocked' : 'hidden',
      hasManagement ? 'runtime_gateway' : 'none',
      {
        reasonCode: hasManagement ? 'runtime_gateway_setup_required' : undefined,
        message: hasManagement ? lifecycleSetupMessage : undefined,
        menuVisibility: hasManagement ? 'stable' : 'hidden',
      },
    ),
    restart: desktopRuntimeOperationPlan(
      'restart',
      hasManagement ? 'blocked' : 'hidden',
      hasManagement ? 'runtime_gateway' : 'none',
      {
        reasonCode: hasManagement ? 'runtime_gateway_setup_required' : undefined,
        message: hasManagement ? lifecycleSetupMessage : undefined,
        packageState: input.package_state,
        maintenance,
        menuVisibility: hasManagement ? 'stable' : 'hidden',
      },
    ),
    update: desktopRuntimeOperationPlan(
      'update',
      hasManagement ? 'blocked' : 'hidden',
      hasManagement ? 'runtime_gateway' : 'none',
      {
        reasonCode: hasManagement ? 'runtime_gateway_setup_required' : undefined,
        message: hasManagement ? lifecycleSetupMessage : undefined,
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
        reasonCode: input.runtime_control_status?.state === 'missing'
          ? 'runtime_control_missing'
          : undefined,
        message: input.runtime_control_status?.state === 'missing'
          ? input.runtime_control_status.message
          : undefined,
      },
    ),
    disconnect_provider: desktopRuntimeOperationPlan('disconnect_provider', 'available', 'runtime_control_rpc', {
      requiresConfirmation: true,
    }),
  };
}
