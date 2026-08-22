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
    case 'pair_gateway':
      return runGatewayLauncherAction({
        kind: 'pair_gateway',
        gateway_id: gateway.gateway_id,
      });
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      // Standalone Gateway cards never own a Runtime or Gateway service
      // lifecycle. These legacy intents are intentionally inert.
      return;
    case 'reinstall_target':
      // Reinstall is a Managed Environment action. Standalone Gateway cards
      // never own a Runtime target and therefore cannot launch it.
      return;
  }
}
