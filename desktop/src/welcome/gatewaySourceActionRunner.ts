import {
  desktopGatewayCanManageService,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopGatewayStartPolicy,
  DesktopLauncherActionKind,
  DesktopLauncherActionRequest,
} from '../shared/desktopLauncherIPC';
import type { GatewaySourceActionModel } from './viewModel';

export type GatewayServiceActionKind = Extract<
  DesktopLauncherActionKind,
  'start_gateway' | 'stop_gateway' | 'restart_gateway' | 'update_gateway' | 'refresh_gateway_status' | 'refresh_gateway_catalog'
>;

export function gatewaySourceActionShouldStartIfNeeded(
  gateway: DesktopGatewaySource,
  action: GatewaySourceActionModel,
): boolean {
  if (!desktopGatewayCanManageService(gateway)) {
    return false;
  }
  if (action.intent !== 'pair_gateway' && action.intent !== 'refresh_gateway_catalog') {
    return false;
  }
  return (gateway.service_state?.status ?? 'unknown') !== 'ready';
}

export function runGatewaySourceAction(
  action: GatewaySourceActionModel,
  gateway: DesktopGatewaySource,
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void,
  pairGateway: (gatewayID: string, startPolicy?: DesktopGatewayStartPolicy) => Promise<void>,
  runGatewayServiceAction: (
    gatewayID: string,
    kind: GatewayServiceActionKind,
    startPolicy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>,
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
      return;
    case 'setup_gateway':
    case 'manage_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'pair_gateway':
      return pairGateway(
        gateway.gateway_id,
        gatewaySourceActionShouldStartIfNeeded(gateway, action) ? 'start_if_needed' : undefined,
      );
    case 'resolve_gateway':
      openCreateGatewaySetup(gateway);
      return;
    case 'start_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'start_gateway');
    case 'stop_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'stop_gateway');
    case 'restart_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'restart_gateway');
    case 'update_gateway':
      return runGatewayServiceAction(gateway.gateway_id, 'update_gateway');
    case 'refresh_gateway_catalog':
      return runGatewayServiceAction(
        gateway.gateway_id,
        'refresh_gateway_catalog',
        gatewaySourceActionShouldStartIfNeeded(gateway, action) ? 'start_if_needed' : undefined,
      );
    case 'refresh_gateway_status':
      return runGatewayLauncherAction({
        kind: 'refresh_gateway_status',
        gateway_id: gateway.gateway_id,
      });
  }
}
