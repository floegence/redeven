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
  selectedSnapshotReinstallTargetProgressForEnvironment,
  type DesktopLauncherBusyState,
} from './launcherBusyState';

export type EnvironmentLifecycleDisclosureIntent = Extract<
  EnvironmentActionIntent,
  'start_runtime' | 'stop_runtime' | 'restart_runtime' | 'update_runtime' | 'refresh_runtime' | 'reinstall_target'
>;

export type EnvironmentLifecycleDisclosureVisibility = 'open' | 'user_closed';

export type EnvironmentLifecycleAttempt = Readonly<{
  operation_key: string;
  started_at_unix_ms: number;
}>;

export type EnvironmentLifecycleDisclosureState = Readonly<{
  environment_id: string;
  intent: EnvironmentLifecycleDisclosureIntent;
  visibility: EnvironmentLifecycleDisclosureVisibility;
  started_at_unix_ms: number;
  operation_key: string;
  operation_binding: 'exact' | 'next_reinstall';
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
    || action.intent === 'update_runtime'
    || action.intent === 'refresh_runtime'
    || (
      action.intent === 'reinstall_target'
      && !action.operation_key
      && !action.preflight_id
    );
}

export function isEnvironmentLifecycleDisclosureIntent(
  intent: EnvironmentActionIntent,
): intent is EnvironmentLifecycleDisclosureIntent {
  return intent === 'start_runtime'
    || intent === 'stop_runtime'
    || intent === 'restart_runtime'
    || intent === 'update_runtime'
    || intent === 'refresh_runtime'
    || intent === 'reinstall_target';
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
    case 'refresh_environment_runtime':
      return 'refresh_runtime';
    case 'reinstall_target':
      return 'reinstall_target';
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
    case 'refresh_runtime':
      return 'refresh_environment_runtime';
    case 'reinstall_target':
      return 'preview_reinstall_target';
    default:
      return 'start_environment_runtime';
  }
}

function lifecycleDisclosureIntentForProgress(
  progress: DesktopLauncherActionProgress | null | undefined,
): EnvironmentLifecycleDisclosureIntent | null {
  if (progress?.action === 'reinstall_target') {
    return 'reinstall_target';
  }
  switch (runtimeLifecycleOperationForActionProgress(progress)) {
    case 'start':
      return 'start_runtime';
    case 'stop':
      return 'stop_runtime';
    case 'restart':
      return 'restart_runtime';
    case 'update':
      return 'update_runtime';
    case 'refresh':
      return 'refresh_runtime';
    default:
      return null;
  }
}

export function beginEnvironmentLifecycleDisclosure(
  _state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
  intent: EnvironmentLifecycleDisclosureIntent,
  attempt: EnvironmentLifecycleAttempt,
): EnvironmentLifecycleDisclosureState {
  return {
    environment_id: environmentID,
    intent,
    visibility: 'open',
    started_at_unix_ms: attempt.started_at_unix_ms,
    operation_key: attempt.operation_key,
    operation_binding: intent === 'reinstall_target' ? 'next_reinstall' : 'exact',
  };
}

export function abandonEnvironmentLifecycleDisclosureAttempt(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
  attempt: EnvironmentLifecycleAttempt,
): EnvironmentLifecycleDisclosureState {
  if (
    !state
    || state.environment_id !== environmentID
    || state.operation_key !== attempt.operation_key
    || state.started_at_unix_ms !== attempt.started_at_unix_ms
    || state.last_progress
  ) {
    return state;
  }
  return null;
}

export function bindEnvironmentLifecycleDisclosureOperation(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
  attempt: EnvironmentLifecycleAttempt,
  operation: EnvironmentLifecycleAttempt,
): EnvironmentLifecycleDisclosureState {
  const operationKey = compact(operation.operation_key);
  const startedAtUnixMS = Number(operation.started_at_unix_ms);
  if (
    !state
    || state.environment_id !== environmentID
    || state.operation_key !== attempt.operation_key
    || state.started_at_unix_ms !== attempt.started_at_unix_ms
    || state.operation_binding !== 'next_reinstall'
    || operationKey === ''
    || !Number.isFinite(startedAtUnixMS)
    || startedAtUnixMS <= 0
  ) {
    return state;
  }
  return {
    ...state,
    operation_key: operationKey,
    started_at_unix_ms: Math.floor(startedAtUnixMS),
    operation_binding: 'exact',
  };
}

export function createEnvironmentLifecycleAttempt(
  environmentID: string,
  intent: EnvironmentLifecycleDisclosureIntent,
): EnvironmentLifecycleAttempt {
  const startedAtUnixMS = Date.now();
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${startedAtUnixMS}-${Math.random().toString(16).slice(2)}`;
  return {
    operation_key: `${compact(environmentID)}:${intent}:${nonce}`,
    started_at_unix_ms: startedAtUnixMS,
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
    || state.operation_binding !== 'exact'
    || lifecycleDisclosureIntentForProgress(progress) !== state.intent
  ) {
    return false;
  }
  return compact(progress.operation_key) === state.operation_key
    && progressStartedAt(progress) === state.started_at_unix_ms;
}

function nextReinstallProgressForDisclosure(
  environment: DesktopEnvironmentEntry,
  progressItems: readonly DesktopLauncherActionProgress[],
  state: Exclude<EnvironmentLifecycleDisclosureState, null>,
): DesktopLauncherActionProgress | null {
  if (state.intent !== 'reinstall_target' || state.operation_binding !== 'next_reinstall') {
    return null;
  }
  return [...progressItems]
    .filter((progress) => (
      progress.action === 'reinstall_target'
      && progressStartedAt(progress) >= state.started_at_unix_ms
      && selectedSnapshotReinstallTargetProgressForEnvironment(environment, [progress]) === progress
    ))
    .sort((left, right) => (
      progressStartedAt(left) - progressStartedAt(right)
      || String(left.operation_key ?? '').localeCompare(String(right.operation_key ?? ''))
    ))[0] ?? null;
}

export function focusEnvironmentLifecycleDisclosure(
  state: EnvironmentLifecycleDisclosureState,
  environmentID: string,
  progress: DesktopLauncherActionProgress,
): EnvironmentLifecycleDisclosureState {
  const intent = lifecycleDisclosureIntentForProgress(progress);
  const startedAtUnixMS = progressStartedAt(progress);
  const operationKey = compact(progress.operation_key);
  if (!intent || startedAtUnixMS <= 0 || operationKey === '') {
    return state;
  }
  return {
    environment_id: environmentID,
    intent,
    visibility: 'open',
    started_at_unix_ms: startedAtUnixMS,
    operation_key: operationKey,
    operation_binding: 'exact',
    last_progress: progress,
  };
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
  const progress = state.operation_binding === 'next_reinstall'
    ? nextReinstallProgressForDisclosure(environment, progressItems, state)
    : progressItems.find((candidate) => (
        progressBelongsToDisclosure(candidate, state)
        && (
          state.intent === 'reinstall_target'
            ? selectedSnapshotReinstallTargetProgressForEnvironment(environment, [candidate]) === candidate
            : environmentMatchesRuntimeLifecycleProgress(environment, candidate)
        )
      )) ?? null;
  if (progress) {
    return {
      ...state,
      started_at_unix_ms: progressStartedAt(progress),
      operation_key: compact(progress.operation_key),
      operation_binding: 'exact',
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
