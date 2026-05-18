import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { environmentSupportsGuidancePopover } from './environmentGuidanceSession';
import { environmentMatchesRuntimeLifecycleProgress } from './launcherBusyState';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';

export type EnvironmentLibraryOverlayKind = 'runtime_menu' | 'primary_action_guidance';

export type EnvironmentLibraryOverlayState =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: EnvironmentLibraryOverlayKind; environment_id: string }>;

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

function entrySupportsPrimaryActionGuidance(environment: DesktopEnvironmentEntry): boolean {
  return environmentSupportsGuidancePopover(environment);
}

export function reconcileEnvironmentLibraryOverlayState(
  state: EnvironmentLibraryOverlayState,
  entries: readonly DesktopEnvironmentEntry[],
  progressItems: readonly DesktopLauncherActionProgress[] = [],
): EnvironmentLibraryOverlayState {
  if (state.kind === 'none') {
    return state;
  }

  const environment = entries.find((entry) => entry.id === state.environment_id);
  if (!environment) {
    return closedEnvironmentLibraryOverlayState();
  }

  if (state.kind === 'runtime_menu') {
    return state;
  }

  if (progressItems.some((progress) => environmentMatchesRuntimeLifecycleProgress(environment, progress))) {
    return state;
  }

  return entrySupportsPrimaryActionGuidance(environment)
    ? state
    : closedEnvironmentLibraryOverlayState();
}
