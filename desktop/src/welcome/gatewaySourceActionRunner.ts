import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import type { GatewaySourceActionModel } from './viewModel';

export function runGatewaySourceAction(
  action: GatewaySourceActionModel,
  gateway: DesktopGatewaySource,
  openCreateGatewaySetup: (gateway?: DesktopGatewaySource) => void,
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
      openCreateGatewaySetup(gateway);
      return;
    case 'refresh_gateway':
      return runGatewayLauncherAction({
        kind: 'refresh_gateway',
        gateway_id: gateway.gateway_id,
      });
    case 'start_gateway':
      return runGatewayLauncherAction({
        kind: 'start_gateway',
        gateway_id: gateway.gateway_id,
      });
    case 'stop_gateway':
      return runGatewayLauncherAction({
        kind: 'stop_gateway',
        gateway_id: gateway.gateway_id,
        impact_acknowledged: true,
      });
    case 'restart_gateway':
      return runGatewayLauncherAction({
        kind: 'restart_gateway',
        gateway_id: gateway.gateway_id,
        impact_acknowledged: true,
      });
    case 'update_gateway':
      return runGatewayLauncherAction({
        kind: 'update_gateway',
        gateway_id: gateway.gateway_id,
        impact_acknowledged: true,
      });
  }
}
