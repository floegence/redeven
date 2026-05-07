import type { DesktopLauncherActionProgress, DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

export type BusyAction =
  | ''
  | 'open_local_environment'
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
  | 'set_local_environment_pinned'
  | 'set_provider_environment_pinned'
  | 'set_saved_environment_pinned'
  | 'set_saved_ssh_environment_pinned'
  | 'delete_control_plane'
  | 'cancel_launcher_operation'
  | 'close_launcher_or_quit'
  | 'save_local_environment_settings'
  | 'save_settings'
  | 'save_environment'
  | 'delete_environment';

export type DesktopLauncherBusyState = Readonly<{
  action: BusyAction;
  environment_id: string;
  provider_origin: string;
  provider_id: string;
  progress: DesktopLauncherActionProgress | null;
}>;

export const IDLE_LAUNCHER_BUSY_STATE: DesktopLauncherBusyState = {
  action: '',
  environment_id: '',
  provider_origin: '',
  provider_id: '',
  progress: null,
};

export function busyStateForLauncherRequest(
  request: DesktopLauncherActionRequest,
): DesktopLauncherBusyState {
  switch (request.kind) {
    case 'save_local_environment_settings':
      return {
        action: 'save_settings',
        environment_id: '',
        provider_origin: '',
        provider_id: '',
        progress: null,
      };
    case 'upsert_saved_environment':
    case 'upsert_saved_ssh_environment':
      return {
        action: 'save_environment',
        environment_id: request.environment_id ?? '',
        provider_origin: '',
        provider_id: '',
        progress: null,
      };
    case 'delete_saved_environment':
    case 'delete_saved_ssh_environment':
      return {
        action: 'delete_environment',
        environment_id: request.environment_id,
        provider_origin: '',
        provider_id: '',
        progress: null,
      };
    case 'refresh_control_plane':
    case 'delete_control_plane':
      return {
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: request.provider_id,
        progress: null,
      };
    case 'cancel_launcher_operation':
      return {
        action: request.kind,
        environment_id: '',
        provider_origin: '',
        provider_id: '',
        progress: null,
      };
    case 'start_control_plane_connect':
      return {
        action: request.kind,
        environment_id: '',
        provider_origin: request.provider_origin,
        provider_id: '',
        progress: null,
      };
    default:
      return {
        action: request.kind,
        environment_id: 'environment_id' in request ? request.environment_id ?? '' : '',
        provider_origin: '',
        provider_id: '',
        progress: null,
      };
  }
}

export function busyStateWithActionProgress(
  state: DesktopLauncherBusyState,
  progress: DesktopLauncherActionProgress,
): DesktopLauncherBusyState {
  if (state.action !== progress.action) {
    return state;
  }
  const progressEnvironmentID = String(progress.environment_id ?? '').trim();
  if (state.environment_id !== '' && progressEnvironmentID !== '' && state.environment_id !== progressEnvironmentID) {
    return state;
  }
  return {
    ...state,
    progress,
  };
}

export function environmentMatchesActionProgress(
  environmentID: string,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress) {
    return false;
  }
  const cleanEnvironmentID = String(environmentID ?? '').trim();
  const progressEnvironmentID = String(progress.environment_id ?? '').trim();
  const operationKey = String(progress.operation_key ?? '').trim();
  return cleanEnvironmentID !== '' && (
    progressEnvironmentID === cleanEnvironmentID
    || operationKey === cleanEnvironmentID
  );
}

export function busyStateMatchesActionProgress(
  state: DesktopLauncherBusyState,
  progress: DesktopLauncherActionProgress | null | undefined,
): boolean {
  if (!progress || state.action !== progress.action) {
    return false;
  }
  if (state.environment_id === '') {
    return false;
  }
  return environmentMatchesActionProgress(state.environment_id, progress);
}

export function activeProgressForEnvironment(
  environmentID: string,
  busyState: DesktopLauncherBusyState,
  progressItems: readonly DesktopLauncherActionProgress[],
): DesktopLauncherActionProgress | null {
  if (
    busyState.progress
    && busyStateMatchesActionProgress(busyState, busyState.progress)
    && environmentMatchesActionProgress(environmentID, busyState.progress)
  ) {
    return busyState.progress;
  }
  return progressItems.find((progress) => environmentMatchesActionProgress(environmentID, progress)) ?? null;
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
