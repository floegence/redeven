import type {
  DesktopEnvironmentEntry,
  DesktopLauncherActionKind,
  DesktopLauncherActionProgress,
} from '../shared/desktopLauncherIPC';
import type {
  EnvironmentActionIntent,
  EnvironmentActionModel,
} from './viewModel';
import {
  environmentMatchesRuntimeLifecycleProgress,
  runtimeLifecycleOperationForActionProgress,
  type DesktopLauncherBusyState,
} from './launcherBusyState';

export type EnvironmentLifecycleDisclosureIntent = Extract<
  EnvironmentActionIntent,
  'start_runtime' | 'stop_runtime' | 'restart_runtime' | 'update_runtime'
>;

export type EnvironmentLifecycleDisclosureVisibility = 'open' | 'user_closed';

export type EnvironmentLifecycleDisclosureState = Readonly<{
  environment_id: string;
  intent: EnvironmentLifecycleDisclosureIntent;
  visibility: EnvironmentLifecycleDisclosureVisibility;
  started_at_unix_ms: number;
  operation_key?: string;
  last_progress?: DesktopLauncherActionProgress;
}> | null;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function environmentActionStartsLifecycleDisclosure(
  action: EnvironmentActionModel,
): action is EnvironmentActionModel & Readonly<{ intent: EnvironmentLifecycleDisclosureIntent }> {
  return action.intent === 'start_runtime'
    || action.intent === 'stop_runtime'
    || action.intent === 'restart_runtime'
    || action.intent === 'update_runtime';
}

export function isEnvironmentLifecycleDisclosureIntent(
  intent: EnvironmentActionIntent,
): intent is EnvironmentLifecycleDisclosureIntent {
  return intent === 'start_runtime'
    || intent === 'stop_runtime'
    || intent === 'restart_runtime'
    || intent === 'update_runtime';
}

export function lifecycleDisclosureIntentForActionKind(
  action: DesktopLauncherActionKind,
): EnvironmentLifecycleDisclosureIntent | null {
  switch (action) {
    case 'start_environment_runtime':
      return 'start_runtime';
    case 'stop_environment_runtime':
      return 'stop_runtime';
    case 'restart_environment_runtime':
      return 'restart_runtime';
    case 'update_environment_runtime':
      return 'update_runtime';
    default:
      return null;
  }
}

function lifecycleActionKindForIntent(intent: EnvironmentLifecycleDisclosureIntent): DesktopLauncherActionKind {
  switch (intent) {
    case 'stop_runtime':
      return 'stop_environment_runtime';
    case 'restart_runtime':
      return 'restart_environment_runtime';
    case 'update_runtime':
      return 'update_environment_runtime';
    default:
      return 'start_environment_runtime';
  }
}

function lifecycleDisclosureIntentForProgress(
  progress: DesktopLauncherActionProgress | null | undefined,
): EnvironmentLifecycleDisclosureIntent | null {
  switch (runtimeLifecycleOperationForActionProgress(progress)) {
    case 'start':
      return 'start_runtime';
    case 'stop':
      return 'stop_runtime';
    case 'restart':
      return 'restart_runtime';
    case 'update':
      return 'update_runtime';
    default:
      return null;
  }
}

export function beginEnvironmentLifecycleDisclosure(
  _state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
  intent: EnvironmentLifecycleDisclosureIntent,
): EnvironmentLifecycleDisclosureState {
  return {
    environment_id: environmentID,
    intent,
    visibility: 'open',
    started_at_unix_ms: Date.now(),
  };
}

export function closeEnvironmentLifecycleDisclosure(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
): EnvironmentLifecycleDisclosureState {
  if (!state || state.environment_id !== environmentID) {
    return state;
  }
  if (state.last_progress && progressIsTerminal(state.last_progress)) {
    return null;
  }
  return {
    ...state,
    visibility: 'user_closed',
  };
}

export function reopenEnvironmentLifecycleDisclosure(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
): EnvironmentLifecycleDisclosureState {
  if (!state || state.environment_id !== environmentID) {
    return state;
  }
  return {
    ...state,
    visibility: 'open',
  };
}

function progressOperationKey(progress: DesktopLauncherActionProgress): string {
  return [
    compact(progress.operation_key) || compact(progress.subject_id),
    String(progress.started_at_unix_ms ?? ''),
  ].filter(Boolean).join(':');
}

function progressIsTerminal(progress: DesktopLauncherActionProgress): boolean {
  return progress.status === 'succeeded'
    || progress.status === 'failed'
    || progress.status === 'canceled'
    || progress.status === 'needs_confirmation'
    || progress.status === 'cleanup_failed';
}

function progressStartedAt(progress: DesktopLauncherActionProgress | null | undefined): number {
  const startedAt = Number(progress?.started_at_unix_ms);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
}

function progressBelongsToDisclosure(
  progress: DesktopLauncherActionProgress | null | undefined,
  state: Exclude<EnvironmentLifecycleDisclosureState, null>,
): progress is DesktopLauncherActionProgress {
  if (
    !progress
    || lifecycleDisclosureIntentForProgress(progress) !== state.intent
  ) {
    return false;
  }
  const progressStarted = progressStartedAt(progress);
  return progressStarted === 0 || progressStarted >= state.started_at_unix_ms;
}

export function reconcileEnvironmentLifecycleDisclosure(
  state: EnvironmentLifecycleDisclosureState,
  entries: readonly DesktopEnvironmentEntry[],
  progressItems: readonly DesktopLauncherActionProgress[],
): EnvironmentLifecycleDisclosureState {
  if (!state) {
    return state;
  }
  const environment = entries.find((entry) => entry.id === state.environment_id);
  if (!environment) {
    return null;
  }
  const progress = progressItems.find((candidate) => (
    progressBelongsToDisclosure(candidate, state)
    && environmentMatchesRuntimeLifecycleProgress(environment, candidate)
  )) ?? null;
  if (progress) {
    return {
      ...state,
      operation_key: progressOperationKey(progress) || state.operation_key,
      last_progress: progress,
    };
  }
  if (state.last_progress && progressIsTerminal(state.last_progress)) {
    return state.visibility === 'open' ? state : null;
  }
  return state;
}

export function environmentLifecycleDisclosureForEnvironment(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
): EnvironmentLifecycleDisclosureState {
  return state?.environment_id === environmentID ? state : null;
}

export function environmentLifecycleDisclosureHasPendingRequest(
  state: EnvironmentLifecycleDisclosureState,
  busyState: Pick<DesktopLauncherBusyState, 'action' | 'environment_id'>,
): boolean {
  return state !== null
    && state.environment_id === busyState.environment_id
    && (
      busyState.action === lifecycleActionKindForIntent(state.intent)
      || busyState.action === 'run_provider_environment_lifecycle'
    );
}

export function visibleEnvironmentLifecycleProgress(input: Readonly<{
  environment: DesktopEnvironmentEntry;
  selectedProgress: DesktopLauncherActionProgress | null | undefined;
  disclosure: EnvironmentLifecycleDisclosureState;
  busyState?: Pick<DesktopLauncherBusyState, 'action' | 'environment_id'>;
}>): DesktopLauncherActionProgress | null {
  if (!input.disclosure) {
    return input.selectedProgress ?? null;
  }
  if (input.disclosure.last_progress) {
    return input.disclosure.last_progress;
  }
  if (progressBelongsToDisclosure(input.selectedProgress, input.disclosure)) {
    return input.selectedProgress;
  }
  return null;
}
