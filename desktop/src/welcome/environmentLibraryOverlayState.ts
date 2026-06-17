import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { environmentSupportsGuidancePopover } from './environmentGuidanceSession';
import { buildEnvironmentCardEndpointsModel } from './viewModel';

export type EnvironmentLibraryOverlayKind = 'runtime_menu' | 'primary_action_guidance' | 'lifecycle_progress' | 'endpoints';

export type EnvironmentLibraryOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: Exclude<EnvironmentLibraryOverlayKind, 'endpoints'>; environment_id: string }>
  | Readonly<{ kind: 'endpoints'; environment_id: string; selected_endpoint_value?: string }>;

export function closedEnvironmentLibraryOverlayState(): EnvironmentLibraryOverlayState {
  return { kind: 'none' };
}

export function openEnvironmentLibraryOverlayState(
  kind: EnvironmentLibraryOverlayKind,
  environmentID: string,
): EnvironmentLibraryOverlayState {
  return {
    kind,
    environment_id: environmentID,
  };
}

export function environmentLibraryOverlayOpenFor(
  state: EnvironmentLibraryOverlayState,
  kind: EnvironmentLibraryOverlayKind,
  environmentID: string,
): boolean {
  return state.kind === kind && state.environment_id === environmentID;
}

export function closeEnvironmentLibraryOverlayState(
  state: EnvironmentLibraryOverlayState,
  kind: EnvironmentLibraryOverlayKind,
  environmentID: string,
): EnvironmentLibraryOverlayState {
  return environmentLibraryOverlayOpenFor(state, kind, environmentID)
    ? closedEnvironmentLibraryOverlayState()
    : state;
}

export function selectEnvironmentEndpointOverlayState(
  environmentID: string,
  endpointValue: string,
): EnvironmentLibraryOverlayState {
  return {
    kind: 'endpoints',
    environment_id: environmentID,
    selected_endpoint_value: endpointValue,
  };
}

export function environmentEndpointOverlaySelectedValueFor(
  state: EnvironmentLibraryOverlayState,
  environmentID: string,
): string | undefined {
  return state.kind === 'endpoints' && state.environment_id === environmentID
    ? state.selected_endpoint_value
    : undefined;
}

function entrySupportsPrimaryActionGuidance(environment: DesktopEnvironmentEntry): boolean {
  return environmentSupportsGuidancePopover(environment);
}

export function reconcileEnvironmentLibraryOverlayState(
  state: EnvironmentLibraryOverlayState,
  entries: readonly DesktopEnvironmentEntry[],
): EnvironmentLibraryOverlayState {
  if (state.kind === 'none') {
    return state;
  }

  const environment = entries.find((entry) => entry.id === state.environment_id);
  if (!environment) {
    return closedEnvironmentLibraryOverlayState();
  }

  if (state.kind === 'runtime_menu' || state.kind === 'lifecycle_progress') {
    return state;
  }

  if (state.kind === 'endpoints') {
    const endpoints = buildEnvironmentCardEndpointsModel(environment);
    if (endpoints.length === 0) {
      return closedEnvironmentLibraryOverlayState();
    }
    return state.selected_endpoint_value !== undefined
      && !endpoints.some((endpoint) => endpoint.value === state.selected_endpoint_value)
      ? {
          kind: 'endpoints',
          environment_id: state.environment_id,
        }
      : state;
  }

  return entrySupportsPrimaryActionGuidance(environment)
    ? state
    : closedEnvironmentLibraryOverlayState();
}
