import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  buildProviderBackedEnvironmentActionModel,
  type EnvironmentActionIntent,
  type EnvironmentPrimaryActionOverlayModel,
} from './viewModel';

export type EnvironmentGuidancePendingIntent = Extract<
  EnvironmentActionIntent,
  'refresh_runtime' | 'start_runtime' | 'serve_runtime_locally'
>;

export type EnvironmentGuidanceFeedbackTone = 'info' | 'warning' | 'error' | 'success';

export type EnvironmentGuidanceFeedback = Readonly<{
  tone: EnvironmentGuidanceFeedbackTone;
  title: string;
  detail: string;
}>;

export type EnvironmentGuidanceSessionState = Readonly<{
  environment_id: string;
  pending_intent: EnvironmentGuidancePendingIntent | null;
  feedback: EnvironmentGuidanceFeedback | null;
}> | null;

export type ActiveEnvironmentGuidanceSessionState = Exclude<EnvironmentGuidanceSessionState, null>;

export function isEnvironmentGuidancePendingIntent(
  intent: EnvironmentActionIntent,
): intent is EnvironmentGuidancePendingIntent {
  return intent === 'refresh_runtime'
    || intent === 'start_runtime'
    || intent === 'serve_runtime_locally';
}

export function openEnvironmentGuidanceSession(
  environmentID: string,
): ActiveEnvironmentGuidanceSessionState {
  return {
    environment_id: environmentID,
    pending_intent: null,
    feedback: null,
  };
}

export function closeEnvironmentGuidanceSession(): EnvironmentGuidanceSessionState {
  return null;
}

export function startEnvironmentGuidanceIntent(
  state: EnvironmentGuidanceSessionState,
  environmentID: string,
  intent: EnvironmentGuidancePendingIntent,
): ActiveEnvironmentGuidanceSessionState {
  const session = state?.environment_id === environmentID
    ? state
    : openEnvironmentGuidanceSession(environmentID);
  return {
    environment_id: session.environment_id,
    pending_intent: intent,
    feedback: null,
  };
}

export function failEnvironmentGuidanceIntent(
  state: EnvironmentGuidanceSessionState,
  detail: string,
): EnvironmentGuidanceSessionState {
  if (!state) {
    return state;
  }

  const title = state.pending_intent === 'start_runtime'
    ? 'Runtime start failed'
    : state.pending_intent === 'serve_runtime_locally'
      ? 'Local runtime action failed'
      : 'Status refresh failed';
  const fallbackDetail = state.pending_intent === 'start_runtime'
    ? 'Desktop could not start the runtime for this environment.'
    : state.pending_intent === 'serve_runtime_locally'
      ? 'Desktop could not continue with the local runtime flow for this environment.'
      : 'Desktop could not refresh the runtime status.';

  return {
    ...state,
    pending_intent: null,
    feedback: {
      tone: 'error',
      title,
      detail: detail.trim() || fallbackDetail,
    },
  };
}

function runtimeStillOfflineDetail(environment: DesktopEnvironmentEntry): string {
  if (environment.kind === 'ssh_environment') {
    return 'The runtime is still offline on this SSH host. Start it from the same host, then try again.';
  }
  return 'The runtime is still offline on this device. Start it from its source, then try again.';
}

function environmentGuidancePopover(
  environment: DesktopEnvironmentEntry,
): Extract<EnvironmentPrimaryActionOverlayModel, Readonly<{ kind: 'popover' }>> | null {
  const overlay = buildProviderBackedEnvironmentActionModel(environment).action_presentation.primary_action_overlay;
  return overlay?.kind === 'popover' ? overlay : null;
}

function runtimeReadyDetail(environment: DesktopEnvironmentEntry): string {
  if (environment.window_state === 'open') {
    return 'The environment window is open and ready to focus.';
  }
  if (environment.window_state === 'opening') {
    return 'Desktop is preparing the environment window.';
  }
  if (environment.kind === 'ssh_environment') {
    return 'The runtime is ready on this SSH host. Open is available now.';
  }
  return 'The runtime is ready. Open is available now.';
}

function feedbackMatches(
  feedback: EnvironmentGuidanceFeedback | null,
  expected: EnvironmentGuidanceFeedback,
): boolean {
  return feedback?.tone === expected.tone
    && feedback.title === expected.title
    && feedback.detail === expected.detail;
}

export function completeEnvironmentGuidanceSuccess(
  state: EnvironmentGuidanceSessionState,
  environment: DesktopEnvironmentEntry | null | undefined,
): EnvironmentGuidanceSessionState {
  if (!state) {
    return state;
  }
  const feedback: EnvironmentGuidanceFeedback = {
    tone: 'success',
    title: 'Runtime ready',
    detail: environment ? runtimeReadyDetail(environment) : 'The runtime is ready. Open is available now.',
  };
  if (state.pending_intent === null && feedbackMatches(state.feedback, feedback)) {
    return state;
  }
  return {
    ...state,
    pending_intent: null,
    feedback,
  };
}

export function completeEnvironmentGuidanceRefresh(
  state: EnvironmentGuidanceSessionState,
  environment: DesktopEnvironmentEntry | null | undefined,
): EnvironmentGuidanceSessionState {
  if (!state) {
    return state;
  }
  if (!environment) {
    return null;
  }
  const popover = environmentGuidancePopover(environment);
  if (!popover) {
    return completeEnvironmentGuidanceSuccess(state, environment);
  }
  return {
    ...state,
    pending_intent: null,
    feedback: {
      tone: 'warning',
      title: popover.title || 'Runtime still needs attention',
      detail: popover.detail || runtimeStillOfflineDetail(environment),
    },
  };
}

export function guidanceSessionKeepsPopoverOpen(
  state: EnvironmentGuidanceSessionState,
): boolean {
  return Boolean(state?.pending_intent || state?.feedback);
}

export function guidanceSessionShouldAutoDismiss(
  state: EnvironmentGuidanceSessionState,
): boolean {
  return state?.feedback?.tone === 'success';
}

export function guidanceSessionNotice(
  state: EnvironmentGuidanceSessionState,
): EnvironmentGuidanceFeedback | null {
  if (!state) {
    return null;
  }
  switch (state.pending_intent) {
    case 'refresh_runtime':
      return {
        tone: 'info',
        title: 'Checking runtime status…',
        detail: 'Desktop is probing the latest runtime health for this environment.',
      };
    case 'start_runtime':
      return {
        tone: 'info',
        title: 'Starting runtime…',
        detail: 'Desktop is starting the local runtime and waiting for the next status update.',
      };
    case 'serve_runtime_locally':
      return {
        tone: 'info',
        title: 'Preparing local runtime…',
        detail: 'Desktop is routing you to the next local runtime step for this environment.',
      };
    default:
      return state.feedback;
  }
}

export function reconcileEnvironmentGuidanceSession(
  state: EnvironmentGuidanceSessionState,
  entries: readonly DesktopEnvironmentEntry[],
): EnvironmentGuidanceSessionState {
  if (!state) {
    return state;
  }
  const environment = entries.find((entry) => entry.id === state.environment_id);
  if (!environment) {
    return null;
  }
  if (!environmentSupportsGuidancePopover(environment)) {
    return guidanceSessionKeepsPopoverOpen(state)
      ? completeEnvironmentGuidanceSuccess(state, environment)
      : null;
  }
  return state;
}

export function environmentSupportsGuidancePopover(
  environment: DesktopEnvironmentEntry,
): boolean {
  return environmentGuidancePopover(environment) !== null;
}
