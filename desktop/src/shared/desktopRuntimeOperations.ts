import type { DesktopRuntimeMaintenanceRequirement } from './desktopRuntimeHealth';
import type { DesktopRuntimePackageState } from './desktopRuntimePackageState';

export type DesktopRuntimeOperation =
  | 'open'
  | 'refresh'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update'
  | 'connect_provider'
  | 'disconnect_provider';

export type DesktopRuntimeOperationAvailability =
  | 'available'
  | 'blocked'
  | 'unavailable'
  | 'hidden';

export type DesktopRuntimeOperationMethod =
  | 'local_host'
  | 'ssh_host'
  | 'local_container_exec'
  | 'ssh_container_exec'
  | 'desktop_local_update_handoff'
  | 'runtime_control_rpc'
  | 'provider_tunnel'
  | 'none';

export type DesktopRuntimeOperationMenuVisibility =
  | 'stable'
  | 'contextual'
  | 'hidden';

export type DesktopRuntimeOperationPlan = Readonly<{
  operation: DesktopRuntimeOperation;
  availability: DesktopRuntimeOperationAvailability;
  method: DesktopRuntimeOperationMethod;
  requires_confirmation: boolean;
  label: string;
  menu_visibility: DesktopRuntimeOperationMenuVisibility;
  reason_code?: string;
  message?: string;
  package_state?: DesktopRuntimePackageState;
  maintenance?: DesktopRuntimeMaintenanceRequirement;
}>;

export type DesktopRuntimeOperationPlans = Readonly<Record<DesktopRuntimeOperation, DesktopRuntimeOperationPlan>>;

export function desktopRuntimeOperationIsAvailable(plan: DesktopRuntimeOperationPlan | undefined): boolean {
  return plan?.availability === 'available';
}

export function desktopRuntimeOperationIsVisible(plan: DesktopRuntimeOperationPlan | undefined): boolean {
  return !!plan && plan.availability !== 'hidden';
}

export function desktopRuntimeOperationLabel(operation: DesktopRuntimeOperation): string {
  switch (operation) {
    case 'open':
      return 'Open';
    case 'refresh':
      return 'Refresh status';
    case 'start':
      return 'Start runtime';
    case 'stop':
      return 'Stop runtime';
    case 'restart':
      return 'Restart runtime';
    case 'update':
      return 'Update runtime';
    case 'connect_provider':
      return 'Connect to provider';
    case 'disconnect_provider':
      return 'Disconnect from provider';
  }
}

export function hiddenDesktopRuntimeOperationPlan(
  operation: DesktopRuntimeOperation,
): DesktopRuntimeOperationPlan {
  return {
    operation,
    availability: 'hidden',
    method: 'none',
    requires_confirmation: false,
    label: desktopRuntimeOperationLabel(operation),
    menu_visibility: 'hidden',
  };
}

export function desktopRuntimeOperationPlan(
  operation: DesktopRuntimeOperation,
  availability: DesktopRuntimeOperationAvailability,
  method: DesktopRuntimeOperationMethod,
  options: Readonly<{
    requiresConfirmation?: boolean;
    label?: string;
    reasonCode?: string;
    message?: string;
    packageState?: DesktopRuntimePackageState;
    maintenance?: DesktopRuntimeMaintenanceRequirement;
    menuVisibility?: DesktopRuntimeOperationMenuVisibility;
  }> = {},
): DesktopRuntimeOperationPlan {
  return {
    operation,
    availability,
    method,
    requires_confirmation: options.requiresConfirmation === true,
    label: options.label ?? desktopRuntimeOperationLabel(operation),
    menu_visibility: options.menuVisibility ?? (
      availability === 'hidden' ? 'hidden' : 'contextual'
    ),
    ...(options.reasonCode ? { reason_code: options.reasonCode } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.packageState ? { package_state: options.packageState } : {}),
    ...(options.maintenance ? { maintenance: options.maintenance } : {}),
  };
}
