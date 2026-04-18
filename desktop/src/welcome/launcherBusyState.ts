import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

export type BusyAction =
  | ''
  | 'open_managed_environment'
  | 'open_provider_environment'
  | 'open_remote_environment'
  | 'open_ssh_environment'
  | 'start_environment_runtime'
  | 'stop_environment_runtime'
  | 'refresh_environment_runtime'
  | 'refresh_all_environment_runtimes'
  | 'start_control_plane_connect'
  | 'focus_environment_window'
  | 'open_environment_settings'
  | 'refresh_control_plane'
  | 'set_managed_environment_pinned'
  | 'set_provider_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'delete_control_plane'
  | 'close_launcher_or_quit'
  | 'upsert_managed_environment'
  | 'upsert_provider_environment_local_runtime'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

export type DesktopLauncherBusyState = Readonly<{
  action: BusyAction;
  environment_id: string;
  provider_origin: string;
  provider_id: string;
}>;

export const IDLE_LAUNCHER_BUSY_STATE: DesktopLauncherBusyState = {
  action: '',
  environment_id: '',
  provider_origin: '',
  provider_id: '',
};

export function busyStateForLauncherRequest(
  request: DesktopLauncherActionRequest,
): DesktopLauncherBusyState {
  switch (request.kind) {
    case 'upsert_managed_environment':
    case 'upsert_provider_environment_local_runtime':
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
      return {
        action: 'save_environment',
        environment_id: request.environment_id ?? '',
        provider_origin: '',
        provider_id: '',
      };
    case 'delete_managed_environment':
    case 'delete_saved_environment':
    case 'delete_saved_ssh_environment':
      return {
        action: 'delete_environment',
        environment_id: request.environment_id,
        provider_origin: '',
        provider_id: '',
      };
    case 'refresh_control_plane':
    case 'delete_control_plane':
      return {
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: request.provider_id,
      };
    case 'start_control_plane_connect':
      return {
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: '',
      };
    default:
      return {
        action: request.kind,
        environment_id: 'environment_id' in request ? request.environment_id ?? '' : '',
        provider_origin: '',
        provider_id: '',
      };
  }
}

export function busyStateMatchesAction(
  state: DesktopLauncherBusyState,
  action: BusyAction,
): boolean {
  return state.action === action;
}

export function busyStateMatchesAnyAction(
  state: DesktopLauncherBusyState,
  actions: readonly BusyAction[],
): boolean {
  return actions.includes(state.action);
}

export function busyStateMatchesEnvironment(
  state: DesktopLauncherBusyState,
  environmentID: string,
  actions?: readonly BusyAction[],
): boolean {
  if (state.environment_id === '' || state.environment_id !== environmentID) {
    return false;
  }
  return actions === undefined ? true : busyStateMatchesAnyAction(state, actions);
}

export function busyStateMatchesControlPlane(
  state: DesktopLauncherBusyState,
  providerOrigin: string,
  providerID: string,
  actions?: readonly BusyAction[],
): boolean {
  if (state.provider_origin === '' || state.provider_origin !== providerOrigin) {
    return false;
  }
  if (providerID !== '' && state.provider_id !== '' && state.provider_id !== providerID) {
    return false;
  }
  return actions === undefined ? true : busyStateMatchesAnyAction(state, actions);
}
