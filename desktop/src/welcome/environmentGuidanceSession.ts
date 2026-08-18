import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import {
  buildProviderBackedEnvironmentActionModel,
  environmentOpenFlow,
  type EnvironmentActionIntent,
  type EnvironmentPrimaryActionOverlayModel,
} from './viewModel';

export type EnvironmentGuidancePendingIntent = Extract<
  EnvironmentActionIntent,
  | 'refresh_runtime'
  | 'connect_provider_runtime'
  | 'disconnect_provider_runtime'
  | 'open_with_preflight'
  | 'initialize_and_open'
  | 'start_and_open'
  | 'request_open_access'
>;

export type EnvironmentOpenFlowStage =
  | 'checking_access'
  | 'preparing_environment'
  | 'starting_environment'
  | 'opening_workspace';

export type EnvironmentGuidanceFeedbackTone = 'info' | 'warning' | 'error' | 'success';

export type EnvironmentGuidanceFeedback = Readonly<{
  tone: EnvironmentGuidanceFeedbackTone;
  title: string;
  detail: string;
}>;

export type EnvironmentGuidanceSessionState = Readonly<{
  environment_id: string;
  pending_intent: EnvironmentGuidancePendingIntent | null;
  open_flow_stage?: EnvironmentOpenFlowStage;
  retry_intent?: Extract<EnvironmentGuidancePendingIntent, 'open_with_preflight' | 'initialize_and_open' | 'start_and_open' | 'request_open_access'>;
  feedback: EnvironmentGuidanceFeedback | null;
}> | null;

export type ActiveEnvironmentGuidanceSessionState = Exclude<EnvironmentGuidanceSessionState, null>;

export function isEnvironmentGuidancePendingIntent(
  intent: EnvironmentActionIntent,
): intent is EnvironmentGuidancePendingIntent {
  return intent === 'refresh_runtime'
    || intent === 'connect_provider_runtime'
    || intent === 'disconnect_provider_runtime'
    || intent === 'open_with_preflight'
    || intent === 'initialize_and_open'
    || intent === 'start_and_open'
    || intent === 'request_open_access';
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
    ...(intent === 'open_with_preflight' || intent === 'initialize_and_open' || intent === 'start_and_open'
      ? { open_flow_stage: 'checking_access' as const }
      : {}),
    feedback: null,
  };
}

export function advanceEnvironmentOpenFlowStage(
  state: EnvironmentGuidanceSessionState,
  stage: EnvironmentOpenFlowStage,
): EnvironmentGuidanceSessionState {
  if (!state || (
    state.pending_intent !== 'open_with_preflight'
    && state.pending_intent !== 'initialize_and_open'
    && state.pending_intent !== 'start_and_open'
  )) {
    return state;
  }
  return { ...state, open_flow_stage: stage };
}

export function failEnvironmentGuidanceIntent(
  state: EnvironmentGuidanceSessionState,
  detail: string,
): EnvironmentGuidanceSessionState {
  if (!state) {
    return state;
  }

  const fallback = (() => {
    switch (state.pending_intent) {
      case 'connect_provider_runtime':
        return {
          title: 'Provider link failed',
          detail: 'Desktop could not connect this runtime to the provider Environment.',
        };
      case 'disconnect_provider_runtime':
        return {
          title: 'Provider unlink failed',
          detail: 'Desktop could not disconnect this runtime from its provider Environment.',
        };
      case 'open_with_preflight':
        return {
          title: 'Open failed',
          detail: 'Redeven could not check this environment. Try again.',
        };
      case 'initialize_and_open':
        return {
          title: 'Initialization failed',
          detail: 'Redeven could not prepare this environment. Try again.',
        };
      case 'start_and_open':
        return {
          title: 'Start failed',
          detail: 'Redeven could not start this environment. Try again.',
        };
      case 'request_open_access':
        return {
          title: 'Request access',
          detail: 'Redeven could not request access to this environment. Try again.',
        };
      default:
        return {
          title: 'Status refresh failed',
          detail: 'Desktop could not refresh the runtime status.',
        };
    }
  })();

  return {
    ...state,
    pending_intent: null,
    ...(state.pending_intent === 'open_with_preflight'
      || state.pending_intent === 'initialize_and_open'
      || state.pending_intent === 'start_and_open'
      || state.pending_intent === 'request_open_access'
      ? { retry_intent: state.pending_intent }
      : {}),
    feedback: {
      tone: 'error',
      title: fallback.title,
      detail: detail.trim() || fallback.detail,
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

export function guidanceSessionOwnsOpenFlowPanel(
  state: EnvironmentGuidanceSessionState,
): boolean {
  const intent = state?.pending_intent ?? state?.retry_intent;
  return intent === 'open_with_preflight'
    || intent === 'initialize_and_open'
    || intent === 'start_and_open'
    || intent === 'request_open_access';
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
    case 'open_with_preflight':
    case 'initialize_and_open':
    case 'start_and_open': {
      const stage = state.open_flow_stage ?? 'checking_access';
      const stageCopy: Record<EnvironmentOpenFlowStage, Readonly<{ title: string; detail: string }>> = {
        checking_access: {
          title: 'Checking access',
          detail: 'Redeven is checking access before changing this environment.',
        },
        preparing_environment: {
          title: 'Preparing environment',
          detail: 'Redeven is preparing the environment so it can start safely.',
        },
        starting_environment: {
          title: 'Starting environment',
          detail: 'Redeven is starting the environment.',
        },
        opening_workspace: {
          title: 'Opening workspace',
          detail: 'Redeven is opening the workspace now.',
        },
      };
      return { tone: 'info', ...stageCopy[stage] };
    }
    case 'request_open_access':
      return {
        tone: 'info',
        title: 'Requesting access',
        detail: 'Redeven is requesting access before opening the workspace.',
      };
    case 'refresh_runtime':
      return {
        tone: 'info',
        title: 'Checking runtime status…',
        detail: 'Desktop is probing the latest runtime health for this environment.',
      };
    case 'connect_provider_runtime':
      return {
        tone: 'info',
        title: 'Connecting runtime…',
        detail: 'Desktop is requesting a provider link ticket and connecting the selected runtime.',
      };
    case 'disconnect_provider_runtime':
      return {
        tone: 'info',
        title: 'Disconnecting runtime…',
        detail: 'Desktop is disconnecting the selected runtime from its provider.',
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
  if (state.pending_intent === null && state.retry_intent) {
    const currentRetryIntent = (() => {
      switch (environmentOpenFlow(environment)) {
        case 'preflight':
          return 'open_with_preflight' as const;
        case 'initialize':
          return 'initialize_and_open' as const;
        case 'start':
          return 'start_and_open' as const;
        case 'request_access':
          return 'request_open_access' as const;
        case 'direct':
          return null;
      }
    })();
    if (!currentRetryIntent) {
      return completeEnvironmentGuidanceSuccess(state, environment);
    }
    if (currentRetryIntent !== state.retry_intent) {
      return { ...state, retry_intent: currentRetryIntent };
    }
  }
  if (guidanceSessionOwnsOpenFlowPanel(state)) {
    return state;
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
