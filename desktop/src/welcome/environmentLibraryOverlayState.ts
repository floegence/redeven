
export type EnvironmentLibraryOverlayKind = 'runtime_menu' | 'primary_action_guidance' | 'lifecycle_progress' | 'endpoints';

export type EnvironmentLibraryOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: Exclude<EnvironmentLibraryOverlayKind, 'endpoints'>; environment_id: string }>
  | Readonly<{ kind: 'endpoints'; environment_id: string; selected_endpoint_id?: string }>;

export function closedEnvironmentLibraryOverlayState(): EnvironmentLibraryOverlayState {
  return { kind: 'none' };
}

/** IMPORTANT: Only explicit session events change visibility; snapshots do not own it. */
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
  endpointID: string,
): EnvironmentLibraryOverlayState {
  return {
    kind: 'endpoints',
    environment_id: environmentID,
    selected_endpoint_id: endpointID,
  };
}

export function environmentEndpointOverlaySelectedIDFor(
  state: EnvironmentLibraryOverlayState,
  environmentID: string,
): string | undefined {
  return state.kind === 'endpoints' && state.environment_id === environmentID
    ? state.selected_endpoint_id
    : undefined;
}
