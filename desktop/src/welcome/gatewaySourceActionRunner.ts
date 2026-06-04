import {
  desktopGatewayCanManageService,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopLauncherActionKind,
  DesktopLauncherActionRequest,
} from '../shared/desktopLauncherIPC';
import type { GatewaySourceActionModel } from './viewModel';

export type GatewayServiceActionKind = Extract<
  DesktopLauncherActionKind,
  'start_gateway' | 'stop_gateway' | 'restart_gateway' | 'update_gateway' | 'sync_gateway'
>;
export type GatewaySourceStartPolicy = 'start_if_needed';

export function gatewaySourceActionShouldStartIfNeeded(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
): boolean {
  if (!desktopGatewayCanManageService(gateway)) {
    return false;
  }
  if (action.intent !== 'pair_gateway' && action.intent !== 'sync_gateway') {
    return false;
  }
  return (gateway.service_state?.status ?? 'unknown') !== 'ready';
}

export function runGatewaySourceAction(
  action: GatewaySourceActionModel,
  gateway: DesktopGatewaySource,
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void,
  pairGateway: (gatewayID: string, startPolicy?: GatewaySourceStartPolicy) => Promise<void>,
  runGatewayServiceAction: (
    gatewayID: string,
    kind: GatewayServiceActionKind,
    startPolicy?: GatewaySourceStartPolicy,
  ) => Promise<void>,
  runGatewayLauncherAction: (request: DesktopLauncherActionRequest) => Promise<void>,
): Promise<void> | void {
  if (!action.enabled) {
    return;
  }
  switch (action.intent) {
    case 'add_gateway_environment':
    case 'view_gateway_environments':
    case 'cancel_gateway_action':
    case 'delete_gateway':
      return;
    case 'enable_gateway':
      return runGatewayLauncherAction({
        kind: 'set_gateway_enabled',
        gateway_id: gateway.gateway_id,
        enabled: true,
      });
    case 'disable_gateway':
      return runGatewayLauncherAction({
        kind: 'set_gateway_enabled',
        gateway_id: gateway.gateway_id,
        enabled: false,
      });
    case 'setup_gateway':
    case 'manage_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'check_gateway':
      return runGatewayLauncherAction({
        kind: 'check_gateway',
        gateway_id: gateway.gateway_id,
      });
    case 'pair_gateway':
    case 'sync_gateway':
      return runGatewayLauncherAction({
        kind: 'sync_gateway',
        gateway_id: gateway.gateway_id,
        ...(gatewaySourceActionShouldStartIfNeeded(gateway, action) ? { start_policy: 'start_if_needed' as const } : {}),
      });
    case 'resolve_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'start_gateway':
      return runGatewayLauncherAction({
        kind: 'sync_gateway',
        gateway_id: gateway.gateway_id,
        start_policy: 'start_if_needed',
      });
    case 'service_start_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'start_gateway');
    case 'stop_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'stop_gateway');
    case 'restart_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'restart_gateway');
    case 'update_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'update_gateway');
    case 'refresh_gateway_catalog':
      return runGatewayLauncherAction({
        kind: 'sync_gateway',
        gateway_id: gateway.gateway_id,
        ...(gatewaySourceActionShouldStartIfNeeded(gateway, action) ? { start_policy: 'start_if_needed' as const } : {}),
      });
    case 'refresh_gateway_status':
      return runGatewayLauncherAction({
        kind: 'sync_gateway',
        gateway_id: gateway.gateway_id,
      });
  }
}
